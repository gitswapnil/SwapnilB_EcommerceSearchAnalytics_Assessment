// index.js
import { setupDatabase } from "./setupDatabase.js"; // your existing setup that creates modular tables
import { processAllFiles } from "./load_fast_copy.js";

async function run() {
  try {
    console.log("🛠 Ensure DB schema exists...");
    await setupDatabase();

    console.log("📦 Starting COPY streaming ETL...");
    await processAllFiles(); // will read raw_data/*.csv and stream COPY
    console.log("🎉 All files processed.");
  } catch (err) {
    console.error("❌ ETL failed:", err);
    process.exitCode = 1;
  }
}

run();
