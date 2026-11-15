import fs from "fs";
import path from "path";

const dir = path.join(process.cwd(), "supabase", "migrations");
const files = fs.readdirSync(dir).sort();
let out = ["-- 01_schema.sql - combined from repo migrations (idempotent)", ""];
for (const f of files) {
  out.push(`-- ===== ${f} =====`);
  out.push(fs.readFileSync(path.join(dir, f), "utf8"));
  out.push("");
}
fs.mkdirSync(path.join(process.cwd(), "sql"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "sql", "01_schema.sql"), out.join("\n"));
console.log("wrote 01_schema.sql, bytes:", fs.statSync(path.join(process.cwd(), "sql", "01_schema.sql")).size, "from", files.length, "migrations");