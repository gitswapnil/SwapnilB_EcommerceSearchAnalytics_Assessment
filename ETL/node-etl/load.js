// load.js
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Client } = pkg;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildInsert(table, cols, count, conflict = null) {
  let placeholders = [];
  let idx = 1;

  for (let r = 0; r < count; r++) {
    let row = [];
    for (let c = 0; c < cols.length; c++) row.push(`$${idx++}`);
    placeholders.push(`(${row.join(",")})`);
  }

  let sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES ${placeholders.join(",")}`;
  if (conflict) sql += ` ON CONFLICT ${conflict} DO NOTHING`;
  return sql + ";";
}

function flat(rows) {
  return rows.flat();
}

export async function loadModularBulk(groups) {
  const client = new Client({ connectionString: process.env.PG_CONNECTION_STRING });
  await client.connect();

  console.log("⚡ Bulk loading...");

  const CHUNK = 800;

  try {
    await client.query("BEGIN");

    const insertSimple = async (table, col, rows, conflict = null) => {
      if (rows.length === 0) return;
      for (const batch of chunk(rows, CHUNK)) {
        const q = buildInsert(table, col, batch.length, conflict);
        const params = flat(batch);
        await client.query(q, params);
      }
      console.log(`✔ Inserted into ${table}`);
    };

    await insertSimple("customers", ["customer_name", "customer_email"], groups.customers, "(customer_email)");
    await insertSimple("brands", ["brand_name"], groups.brands, "(brand_name)");
    await insertSimple("categories", ["category_name"], groups.categories, "(category_name)");
    await insertSimple("collections", ["collection_name"], groups.collections, "(collection_name)");

    await insertSimple(
      "searches",
      ["search_id", "customer_id", "search_keyword", "attributes", "min_price", "max_price", "min_rating", "total_results", "search_date"],
      groups.searches,
      "(search_id)"
    );

    await insertSimple("ip_addresses", ["search_id", "ip_address"], groups.ip_addresses);
    await insertSimple("search_metrics", ["search_id", "min_price", "max_price", "min_rating", "total_results"], groups.metrics);

    await insertSimple("search_brands", ["search_id", "brand_id"], groups.search_brands);
    await insertSimple("search_categories", ["search_id", "category_id"], groups.search_categories);
    await insertSimple("search_collections", ["search_id", "collection_id"], groups.search_collections);

    await client.query("COMMIT");
    console.log("🎉 Bulk load completed!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Bulk load failed:", err);
  } finally {
    await client.end();
  }
}
