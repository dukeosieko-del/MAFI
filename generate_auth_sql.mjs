/**
 * Generate SQL to insert auth users into the local Docker Postgres (GoTrue schema).
 * Maps exported fields onto the real auth.users columns.
 */
import fs from "fs";
import path from "path";

const OUT = path.join(process.cwd(), "out");
const SQL = path.join(process.cwd(), "sql");
const users = JSON.parse(fs.readFileSync(path.join(OUT, "auth_users.json"), "utf8"));

const cols = ["id","aud","role","email","email_confirmed_at","phone","confirmed_at","last_sign_in_at","app_metadata","user_metadata","identities","created_at","updated_at","is_anonymous"];
const out = [];
out.push("-- 03_auth_users.sql - restore auth.users from Supabase export (GoTrue schema)");
out.push("BEGIN;");
let n = 0;
for (const u of users) {
  const vals = cols.map(c => {
    const v = u[c];
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
    if (typeof v === "string") return "'" + v.replace(/'/g, "''") + "'";
    return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
  }).join(", ");
  out.push(`INSERT INTO auth.users (${cols.map(c=>`"${c}"`).join(", ")}) VALUES (${vals}) ON CONFLICT (id) DO NOTHING;`);
  n++;
}
out.push("COMMIT;");
fs.writeFileSync(path.join(SQL, "03_auth_users.sql"), out.join("\n"));
console.log("wrote 03_auth_users.sql with", n, "users");