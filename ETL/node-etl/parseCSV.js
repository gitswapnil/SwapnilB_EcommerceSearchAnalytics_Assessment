// parseCSV.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function detectDelimiter(sample) {
  // Check tab
  if (sample.includes("\t")) return "\t";
  // Check comma
  if (sample.includes(",")) return ",";
  // Check semicolon
  if (sample.includes(";")) return ";";
  // Default
  return ",";
}

export function parseCSV() {
  const filePath = path.join(__dirname, "raw_data", "nov 15 - nov 30.csv");
  const content = fs.readFileSync(filePath, "utf8");

  // Detect delimiter using only the header line
  const firstLine = content.split("\n")[0];
  const delimiter = detectDelimiter(firstLine);

  console.log(`📌 Detected CSV delimiter: "${delimiter.replace("\t","TAB")}"`);

  const records = parse(content, {
    delimiter,
    columns: header => header.map(h => h.trim()),
    skip_empty_lines: true,
    relax_column_count: true
  });

  return records;
}
