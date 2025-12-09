// load.js
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Client } = pkg;

// helper to chunk arrays
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// build multi-row INSERT ... ON CONFLICT DO NOTHING query
function buildInsertQuery(table, columns, rowCount, onConflict = null) {
  // columns: ['col1','col2']
  const cols = columns.join(", ");
  const valuePlaceholders = [];
  let paramIndex = 1;
  for (let r = 0; r < rowCount; r++) {
    const placeholders = [];
    for (let c = 0; c < columns.length; c++) {
      placeholders.push(`$${paramIndex++}`);
    }
    valuePlaceholders.push(`(${placeholders.join(", ")})`);
  }
  let q = `INSERT INTO ${table} (${cols}) VALUES ${valuePlaceholders.join(", ")}`;
  if (onConflict) q += ` ON CONFLICT ${onConflict} DO NOTHING`;
  q += ";";
  return q;
}

// flatten rows into params array
function flattenParams(rows) {
  return rows.flat();
}

export async function loadModularBulk(groups) {
  const client = new Client({ connectionString: process.env.PG_CONNECTION_STRING });
  await client.connect();
  console.log("🔌 Connected to Postgres for bulk load");

  // tune chunk size (params per query limit; also avoid huge queries)
  const CHUNK_SIZE = 800; // number of rows per multi-insert chunk (tweak as needed)

  try {
    await client.query("BEGIN");

    // 1) customers (name,email) - unique on email
    if (groups.customers.length > 0) {
      const chunks = chunkArray(groups.customers, CHUNK_SIZE);
      for (const chunk of chunks) {
        const q = buildInsertQuery("customers", ["customer_name", "customer_email"], chunk.length, "(customer_email)");
        const params = flattenParams(chunk);
        await client.query(q, params);
      }
      console.log(`✔ Upserted customers (chunks: ${chunks.length})`);
    }

    // 2) brands, categories, collections (unique name)
    const insertLookup = async (table, colName, rows) => {
      if (rows.length === 0) return;
      const chunks = chunkArray(rows, CHUNK_SIZE);
      for (const chunk of chunks) {
        const q = buildInsertQuery(table, [colName], chunk.length, `(${colName})`);
        const params = flattenParams(chunk);
        await client.query(q, params);
      }
      console.log(`✔ Upserted ${table} (chunks: ${chunks.length})`);
    };

    await insertLookup("brands", "brand_name", groups.brands);
    await insertLookup("categories", "category_name", groups.categories);
    await insertLookup("collections", "collection_name", groups.collections);

    // 3) prepare maps: customer email -> id, brand_name -> id, category_name -> id, collection_name -> id
    const buildIdMap = async (table, keyCol, idCol = null, values = []) => {
      if (values.length === 0) return new Map();
      idCol = idCol || `${table.slice(0, -1)}_id`; // simple guess, e.g., brands -> brand_id
      // use SELECT ... WHERE IN (...)
      const q = `SELECT ${idCol} as id, ${keyCol} as name FROM ${table} WHERE ${keyCol} = ANY($1)`;
      const res = await client.query(q, [values]);
      const map = new Map();
      for (const row of res.rows) map.set(row.name, row.id);
      return map;
    };

    // gather keys arrays for maps
    const brandNames = groups.brands.map(r => r[0]);
    const categoryNames = groups.categories.map(r => r[0]);
    const collectionNames = groups.collections.map(r => r[0]);

    const brandMap = await buildIdMap("brands", "brand_name", "brand_id", brandNames);
    const categoryMap = await buildIdMap("categories", "category_name", "category_id", categoryNames);
    const collectionMap = await buildIdMap("collections", "collection_name", "collection_id", collectionNames);

    // customers map: use emails that exist
    const customerEmails = groups.customers.map(r => r[1]).filter(e => e);
    const customerMap = await buildIdMap("customers", "customer_email", "customer_id", customerEmails);

    // 4) searches (search_id, customer_id, search_keyword, attributes, min_price, max_price, min_rating, total_results, search_date)
    if (groups.searches.length > 0) {
      const chunks = chunkArray(groups.searches, CHUNK_SIZE);
      for (const chunk of chunks) {
        // before insert, resolve customer_id placeholders by matching customer email? 
        // Our grouped searches had customer_id placeholder null; we will insert searches without customer_id (null) now,
        // then update with customer_id if you wish. Alternatively, if you want to link by email you must provide a mapping between searches and customers.
        // For now we insert searches as-is (customer_id null). If you have a way to link search->customer (like email in original row), we can update.
        const q = buildInsertQuery(
          "searches",
          ["search_id","customer_id","search_keyword","attributes","min_price","max_price","min_rating","total_results","search_date"],
          chunk.length,
          "(search_id)"
        );
        const params = flattenParams(chunk);
        await client.query(q, params);
      }
      console.log(`✔ Inserted searches (chunks: ${Math.ceil(groups.searches.length/CHUNK_SIZE)})`);
    }

    // 5) ip_addresses (search_id, ip_address)
    if (groups.ip_addresses.length > 0) {
      const chunks = chunkArray(groups.ip_addresses, CHUNK_SIZE);
      for (const chunk of chunks) {
        const q = buildInsertQuery("ip_addresses", ["search_id","ip_address"], chunk.length);
        const params = flattenParams(chunk);
        await client.query(q, params);
      }
      console.log("✔ Inserted ip_addresses");
    }

    // 6) search_metrics (search_id, min_price, max_price, min_rating, total_results)
    if (groups.metrics.length > 0) {
      const chunks = chunkArray(groups.metrics, CHUNK_SIZE);
      for (const chunk of chunks) {
        const q = buildInsertQuery("search_metrics", ["search_id","min_price","max_price","min_rating","total_results"], chunk.length);
        const params = flattenParams(chunk);
        await client.query(q, params);
      }
      console.log("✔ Inserted search_metrics");
    }

    // 7) mapping tables: search_brands, search_categories, search_collections
    // For each mapping list we convert names -> ids using the maps we fetched
    const convertMappingRows = (pairs, map) => {
      // pairs: [ [search_id, name], ... ]
      const rows = [];
      for (const [search_id, name] of pairs) {
        const id = map.get(name);
        if (id) rows.push([search_id, id]);
      }
      return rows;
    };

    const sbRows = convertMappingRows(groups.search_brands, brandMap);
    const scRows = convertMappingRows(groups.search_categories, categoryMap);
    const scolRows = convertMappingRows(groups.search_collections, collectionMap);

    const insertMappings = async (table, cols, rows) => {
      if (!rows.length) return;
      const chunks = chunkArray(rows, CHUNK_SIZE);
      for (const chunk of chunks) {
        const q = buildInsertQuery(table, cols, chunk.length);
        const params = flattenParams(chunk);
        await client.query(q, params);
      }
      console.log(`✔ Inserted ${table}`);
    };

    await insertMappings("search_brands", ["search_id","brand_id"], sbRows);
    await insertMappings("search_categories", ["search_id","category_id"], scRows);
    await insertMappings("search_collections", ["search_id","collection_id"], scolRows);

    await client.query("COMMIT");
    console.log("✅ Bulk modular load completed successfully");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Bulk load error:", err);
    throw err;
  } finally {
    await client.end();
    console.log("🔌 Postgres connection closed");
  }
}
