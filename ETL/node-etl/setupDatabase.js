// setupDatabase.js
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Client } = pkg;
const DB_NAME = "ecommerce_search";

export async function setupDatabase() {
  console.log("🛠 Setting up modular database...");

  // admin client to create DB if missing
  const adminClient = new Client({
    connectionString: process.env.PG_ADMIN_CONNECTION_STRING,
  });
  await adminClient.connect();

  const checkDB = `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}';`;
  const res = await adminClient.query(checkDB);
  if (res.rowCount === 0) {
    console.log(`📌 Creating DB ${DB_NAME}`);
    await adminClient.query(`CREATE DATABASE ${DB_NAME};`);
  } else {
    console.log(`✔ Database ${DB_NAME} exists`);
  }
  await adminClient.end();

  // connect to target DB
  const dbClient = new Client({ connectionString: process.env.PG_CONNECTION_STRING });
  await dbClient.connect();

  // customers
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS customers (
      customer_id SERIAL PRIMARY KEY,
      customer_name TEXT,
      customer_email TEXT UNIQUE
    );
  `);

  // lookup tables
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS brands (
      brand_id SERIAL PRIMARY KEY,
      brand_name TEXT UNIQUE
    );
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS categories (
      category_id SERIAL PRIMARY KEY,
      category_name TEXT UNIQUE
    );
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS collections (
      collection_id SERIAL PRIMARY KEY,
      collection_name TEXT UNIQUE
    );
  `);

  // main searches table
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS searches (
      search_id TEXT PRIMARY KEY,
      customer_id INT REFERENCES customers(customer_id),
      search_keyword TEXT,
      attributes TEXT,
      min_price NUMERIC,
      max_price NUMERIC,
      min_rating NUMERIC,
      total_results INT,
      search_date TIMESTAMP
    );
  `);

  // mapping tables
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS search_brands (
      id SERIAL PRIMARY KEY,
      search_id TEXT REFERENCES searches(search_id) ON DELETE CASCADE,
      brand_id INT REFERENCES brands(brand_id)
    );
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS search_categories (
      id SERIAL PRIMARY KEY,
      search_id TEXT REFERENCES searches(search_id) ON DELETE CASCADE,
      category_id INT REFERENCES categories(category_id)
    );
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS search_collections (
      id SERIAL PRIMARY KEY,
      search_id TEXT REFERENCES searches(search_id) ON DELETE CASCADE,
      collection_id INT REFERENCES collections(collection_id)
    );
  `);

  // ip addresses and metrics
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS ip_addresses (
      ip_id SERIAL PRIMARY KEY,
      search_id TEXT REFERENCES searches(search_id) ON DELETE CASCADE,
      ip_address TEXT
    );
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS search_metrics (
      metrics_id SERIAL PRIMARY KEY,
      search_id TEXT REFERENCES searches(search_id) ON DELETE CASCADE,
      min_price NUMERIC,
      max_price NUMERIC,
      min_rating NUMERIC,
      total_results INT
    );
  `);

  // indexes
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_search_date ON searches(search_date);
    CREATE INDEX IF NOT EXISTS idx_keyword ON searches(search_keyword);
    CREATE INDEX IF NOT EXISTS idx_brand_name ON brands(brand_name);
    CREATE INDEX IF NOT EXISTS idx_category_name ON categories(category_name);
    CREATE INDEX IF NOT EXISTS idx_collection_name ON collections(collection_name);
    CREATE INDEX IF NOT EXISTS idx_ip_address ON ip_addresses(ip_address);
  `);

  console.log("✔ Schema created/updated");
  try {
    await dbClient.query("VACUUM ANALYZE;");
  } catch (e) {
    // skip if not permitted
  }

  await dbClient.end();
  console.log("✅ setupDatabase complete");
}
