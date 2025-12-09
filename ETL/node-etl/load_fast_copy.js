// load_fast_insert.js — STABLE VERSION WITHOUT COPY (Batch INSERT)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";
import { parse } from "csv-parse";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BATCH_SIZE = 500; // safe for Supabase

// Helpers
function safeNumber(v) {
  if (!v || v.trim() === "") return null;
  return Number(v);
}

function safeDate(v) {
  if (!v || v.trim() === "") return null;
  return new Date(v).toISOString();
}

function safeJSON(v) {
  if (!v || v.trim() === "") return null;

  try {
    return JSON.stringify(JSON.parse(v)); // normalize JSON
  } catch {
    return v; // fallback text
  }
}

async function insertLookups(db, table, column, values) {
  if (!values.length) return;

  const unique = [...new Set(values)];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const chunk = unique.slice(i, i + BATCH_SIZE);
    const params = chunk.map((_, idx) => `($${idx + 1})`).join(",");
    await db.query(
      `INSERT INTO ${table} (${column}) VALUES ${params}
       ON CONFLICT (${column}) DO NOTHING`,
      chunk
    );
  }
}

async function fetchLookupMap(db, table, textCol, idCol, list) {
  if (!list.length) return new Map();
  const res = await db.query(
    `SELECT ${textCol}, ${idCol} FROM ${table} WHERE ${textCol} = ANY($1)`,
    [list]
  );
  return new Map(res.rows.map(r => [r[textCol], r[idCol]]));
}

// MAIN ETL PROCESSOR
export async function processAllFiles() {
  const db = new Client({
    connectionString: process.env.PG_CONNECTION_STRING
  });

  await db.connect();

  console.log("🔎 Scanning raw_data directory...");
  const csvFile = fs.readdirSync(path.join(__dirname, "raw_data"))
    .find(f => f.endsWith(".csv"));

  if (!csvFile) {
    console.log("❌ No CSV files found");
    return;
  }

  const filePath = path.join(__dirname, "raw_data", csvFile);
  console.log("📄 Processing:", filePath);

  const emails = new Set();
  const brands = new Set();
  const categories = new Set();
  const collections = new Set();

  const rows = [];

  // First pass — read CSV
  await new Promise((resolve, reject) => {
    const parser = parse({
      columns: true,
      delimiter: ",",
      trim: true,
      skip_empty_lines: true
    });

    fs.createReadStream(filePath).pipe(parser);

    parser.on("readable", () => {
      let r;
      while ((r = parser.read()) !== null) {
        rows.push(r);

        if (r["Customer Email"])
          emails.add(r["Customer Email"].trim().toLowerCase());

        (r["Brands"] || "")
          .split(",")
          .map(v => v.trim())
          .filter(Boolean)
          .forEach(v => brands.add(v));

        (r["Categories"] || "")
          .split(",")
          .map(v => v.trim())
          .filter(Boolean)
          .forEach(v => categories.add(v));

        (r["Collections"] || "")
          .split(",")
          .map(v => v.trim())
          .filter(Boolean)
          .forEach(v => collections.add(v));
      }
    });

    parser.on("end", resolve);
    parser.on("error", reject);
  });

  console.log("📊 CSV rows:", rows.length);

  // Upsert Lookups
  await insertLookups(db, "customers", "customer_email", [...emails]);
  await insertLookups(db, "brands", "brand_name", [...brands]);
  await insertLookups(db, "categories", "category_name", [...categories]);
  await insertLookups(db, "collections", "collection_name", [...collections]);

  // Fetch lookup IDs
  const customerMap = await fetchLookupMap(db, "customers", "customer_email", "customer_id", [...emails]);
  const brandMap = await fetchLookupMap(db, "brands", "brand_name", "brand_id", [...brands]);
  const categoryMap = await fetchLookupMap(db, "categories", "category_name", "category_id", [...categories]);
  const collectionMap = await fetchLookupMap(db, "collections", "collection_name", "collection_id", [...collections]);

  // Batched inserts for searches & relations
  const searchBatch = [];
  const metricBatch = [];
  const ipBatch = [];
  const brandBatch = [];
  const categoryBatch = [];
  const collectionBatch = [];

  for (const r of rows) {
    const sid = r["Search ID"];
    if (!sid) continue;

    const email = (r["Customer Email"] || "").trim().toLowerCase();
    const customerId = customerMap.get(email) || null;

    const attrs = safeJSON(r["Attributes"]);
    const minPrice = safeNumber(r["Min Price"]);
    const maxPrice = safeNumber(r["Max Price"]);
    const minRating = safeNumber(r["Min Rating"]);
    const totalResults = safeNumber(r["Total Results"]);
    const searchDate = safeDate(r["Search Date"]);

    // MAIN SEARCH
    searchBatch.push({
      sid,
      customerId,
      keyword: r["Search Keyword"] || null,
      attrs,
      minPrice,
      maxPrice,
      minRating,
      totalResults,
      searchDate
    });

    // METRICS
    metricBatch.push({
      sid,
      minPrice,
      maxPrice,
      minRating,
      totalResults
    });

    // IP ADDRESSES
    (r["IP Address"] || "")
      .split(",")
      .map(ip => ip.trim())
      .filter(Boolean)
      .forEach(ip => {
        ipBatch.push({ sid, ip });
      });

    // BRANDS
    (r["Brands"] || "")
      .split(",")
      .map(b => b.trim())
      .filter(Boolean)
      .forEach(b => {
        brandBatch.push({
          sid,
          id: brandMap.get(b) || null
        });
      });

    // CATEGORIES
    (r["Categories"] || "")
      .split(",")
      .map(c => c.trim())
      .filter(Boolean)
      .forEach(c => {
        categoryBatch.push({
          sid,
          id: categoryMap.get(c) || null
        });
      });

    // COLLECTIONS
    (r["Collections"] || "")
      .split(",")
      .map(c => c.trim())
      .filter(Boolean)
      .forEach(c => {
        collectionBatch.push({
          sid,
          id: collectionMap.get(c) || null
        });
      });
  }

  console.log("🚀 Inserting into searches table...");

  // Insert batched searches
  for (let i = 0; i < searchBatch.length; i += BATCH_SIZE) {
    const chunk = searchBatch.slice(i, i + BATCH_SIZE);

    const values = [];
    const placeholders = chunk
      .map((row, idx) => {
        const base = idx * 9;
        values.push(
          row.sid,
          row.customerId,
          row.keyword,
          row.attrs,
          row.minPrice,
          row.maxPrice,
          row.minRating,
          row.totalResults,
          row.searchDate
        );
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9})`;
      })
      .join(",");

    await db.query(
      `INSERT INTO searches (
        search_id, customer_id, search_keyword, attributes,
        min_price, max_price, min_rating, total_results, search_date
      ) VALUES ${placeholders}
      ON CONFLICT (search_id) DO NOTHING`,
      values
    );
  }

  console.log("✔ Inserted searches");

  // Insert relations (brands/categories/etc.)
  function batchInsert(table, rows, cols) {
    return db.query(
      `INSERT INTO ${table} (${cols.join(",")})
       VALUES ${rows.map((_, i) => `($${i * cols.length + 1},$${i * cols.length + 2})`).join(",")}
       ON CONFLICT DO NOTHING`,
      rows.flatMap(r => [r.sid, r.id])
    );
  }

  console.log("✔ Inserting metrics...");
  for (let i = 0; i < metricBatch.length; i += BATCH_SIZE) {
    const chunk = metricBatch.slice(i, i + BATCH_SIZE);
    const values = [];
    const placeholders = chunk
      .map((m, idx) => {
        const base = idx * 5;
        values.push(m.sid, m.minPrice, m.maxPrice, m.minRating, m.totalResults);
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`;
      })
      .join(",");
    await db.query(
      `INSERT INTO search_metrics (
         search_id, min_price, max_price, min_rating, total_results
       ) VALUES ${placeholders}
       ON CONFLICT DO NOTHING`,
      values
    );
  }

  console.log("✔ Inserting brands...");
  if (brandBatch.length) {
    for (let i = 0; i < brandBatch.length; i += BATCH_SIZE) {
      const chunk = brandBatch.slice(i, i + BATCH_SIZE);
      await batchInsert("search_brands", chunk, ["search_id", "brand_id"]);
    }
  }

  console.log("✔ Inserting categories...");
  if (categoryBatch.length) {
    for (let i = 0; i < categoryBatch.length; i += BATCH_SIZE) {
      const chunk = categoryBatch.slice(i, i + BATCH_SIZE);
      await batchInsert("search_categories", chunk, ["search_id", "category_id"]);
    }
  }

  console.log("✔ Inserting collections...");
  if (collectionBatch.length) {
    for (let i = 0; i < collectionBatch.length; i += BATCH_SIZE) {
      const chunk = collectionBatch.slice(i, i + BATCH_SIZE);
      await batchInsert("search_collections", chunk, ["search_id", "collection_id"]);
    }
  }

  console.log("🎉 ETL COMPLETED SUCCESSFULLY USING INSERTS");

  await db.end();
}
