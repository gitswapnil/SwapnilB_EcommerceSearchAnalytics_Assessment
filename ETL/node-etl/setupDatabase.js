// setupDatabase.js — Supabase-safe version (NO CREATE DATABASE)
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Client } = pkg;

export async function setupDatabase() {
  console.log("🛠 Setting up modular database (Supabase-safe mode)...");

  // Directly connect to existing Supabase database: postgres
  const db = new Client({
    connectionString: process.env.PG_CONNECTION_STRING,
  });

  await db.connect();
  console.log("✔ Connected to existing Supabase database: postgres");

  // ------ TABLES ------

  await db.query(`
    CREATE TABLE IF NOT EXISTS customers (
      customer_id SERIAL PRIMARY KEY,
      customer_name TEXT,
      customer_email TEXT UNIQUE
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS brands (
      brand_id SERIAL PRIMARY KEY,
      brand_name TEXT UNIQUE
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS categories (
      category_id SERIAL PRIMARY KEY,
      category_name TEXT UNIQUE
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS collections (
      collection_id SERIAL PRIMARY KEY,
      collection_name TEXT UNIQUE
    );
  `);

  await db.query(`
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

  await db.query(`
    CREATE TABLE IF NOT EXISTS search_brands (
      id SERIAL PRIMARY KEY,
      search_id TEXT REFERENCES searches(search_id) ON DELETE CASCADE,
      brand_id INT REFERENCES brands(brand_id)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS search_categories (
      id SERIAL PRIMARY KEY,
      search_id TEXT REFERENCES searches(search_id) ON DELETE CASCADE,
      category_id INT REFERENCES categories(category_id)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS search_collections (
      id SERIAL PRIMARY KEY,
      search_id TEXT REFERENCES searches(search_id) ON DELETE CASCADE,
      collection_id INT REFERENCES collections(collection_id)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ip_addresses (
      ip_id SERIAL PRIMARY KEY,
      search_id TEXT REFERENCES searches(search_id) ON DELETE CASCADE,
      ip_address TEXT
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS search_metrics (
      metrics_id SERIAL PRIMARY KEY,
      search_id TEXT REFERENCES searches(search_id) ON DELETE CASCADE,
      min_price NUMERIC,
      max_price NUMERIC,
      min_rating NUMERIC,
      total_results INT
    );
  `);

  // Recommended indexing
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_search_date ON searches(search_date);
    CREATE INDEX IF NOT EXISTS idx_keyword ON searches(search_keyword);
    CREATE INDEX IF NOT EXISTS idx_brand_name ON brands(brand_name);
    CREATE INDEX IF NOT EXISTS idx_category_name ON categories(category_name);
  `);

  console.log("✔ All required tables are ready inside database: postgres");
  await db.end();
}
