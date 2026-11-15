/**
 * Convert extracted JSON rows into parameterized COPY/INSERT SQL for the Docker DB.
 * Outputs ./sql/02_data.sql (raw SQL with literal values).
 * Handles: JSON/JSONB, arrays, booleans, numbers, nulls, timestamptz, uuid, text.
 */
import fs from "fs";
import path from "path";

const OUT = path.join(process.cwd(), "out");
const SQL = path.join(process.cwd(), "sql");
fs.mkdirSync(SQL, { recursive: true });

const pub = JSON.parse(fs.readFileSync(path.join(OUT, "public_tables.json"), "utf8"));

function sqlVal(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "string") {
    // escape single quotes
    return "'" + v.replace(/'/g, "''") + "'";
  }
  // object/array -> JSON
  const s = JSON.stringify(v).replace(/'/g, "''");
  return `'${s}'::jsonb`;
}

let out = [];
out.push("-- Data load generated from Supabase REST export. Read-only source.");
out.push("BEGIN;");
let totalRows = 0;
for (const [table, entry] of Object.entries(pub)) {
  const tname = table.replace(/^\//, "");
  const rows = entry.rows || [];
  if (rows.length === 0) continue;
  const cols = Object.keys(rows[0]);
  totalRows += rows.length;
  out.push(`-- ${tname}: ${rows.length} rows`);
  out.push(`TRUNCATE TABLE public.${tname} RESTART IDENTITY CASCADE;`);
  for (const row of rows) {
    const vals = cols.map(c => sqlVal(row[c])).join(", ");
    out.push(`INSERT INTO public.${tname} (${cols.map(c => `"${c}"`).join(", ")}) VALUES (${vals});`);
  }
}
out.push("COMMIT;");
out.push(`-- Total rows: ${totalRows}`);
fs.writeFileSync(path.join(SQL, "02_data.sql"), out.join("\n"));
console.log("Wrote 02_data.sql with", totalRows, "rows across", Object.keys(pub).length, "tables");