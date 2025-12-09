// parseCSV.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function detectDelimiter(sample) {
  if (sample.includes("\t")) return "\t";
  if (sample.includes(",")) return ",";
  if (sample.includes(";")) return ";";
  return ",";
}

export function readAllCSVFiles() {
  const dirPath = path.join(__dirname, "raw_data");

  const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".csv"));
  if (files.length === 0) return [];

  let allRecords = [];

  for (const file of files) {
    const fp = path.join(dirPath, file);
    const content = fs.readFileSync(fp, "utf8");
    const delimiter = detectDelimiter(content.split("\n")[0]);

    console.log(`📥 Reading ${file} (delimiter: ${delimiter})`);

    const rec = parse(content, {
      delimiter,
      columns: header => header.map(h => h.trim()),
      skip_empty_lines: true,
      relax_column_count: true,
    });

    allRecords.push(...rec);
  }

  return allRecords;
}
