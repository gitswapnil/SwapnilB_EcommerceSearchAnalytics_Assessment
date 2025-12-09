// index.js
import { setupDatabase } from "./setupDatabase.js";
import { parseCSV } from "./parseCSV.js";
import { transformData, groupForBulkInsert } from "./transform.js";
import { loadModularBulk } from "./load.js";

async function runETL() {
  try {
    console.log("🛠 Setup DB (if needed)...");
    await setupDatabase();

    console.log("📥 Extracting CSV...");
    const raw = parseCSV();

    console.log("🔄 Transforming CSV...");
    const transformed = transformData(raw);

    console.log("🧩 Grouping for bulk load...");
    const groups = groupForBulkInsert(transformed);

    console.log("📤 Loading to PostgreSQL (bulk)...");
    await loadModularBulk(groups);

    console.log("🎉 ETL finished");
  } catch (err) {
    console.error("ETL failed:", err);
  }
}

runETL();
