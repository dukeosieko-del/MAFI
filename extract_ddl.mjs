/**
 * Extract DDL-relevant metadata from Supabase OpenAPI:
 * - column names + types per table
 * - primary keys
 * - RPC function signatures
 * Also dump the OpenAPI fully for later analysis.
 */
import fs from "fs";
import path from "path";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rousjavuooduvicaobuv.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: "Bearer " + KEY, Accept: "application/openapi+json" };

const j = await (await fetch(`${URL}/rest/v1/`, { headers: H })).json();
const out = { tables: {}, rpcs: {} };

for (const [p, def] of Object.entries(j.paths || {})) {
  if (p.startsWith("/rpc/")) {
    out.rpcs[p.replace("/rpc/", "")] = def.get || {};
    continue;
  }
  if (p === "/") continue;
  const schema = (def.get || {}).responses?.["200"]?.schema || {};
  const props = schema.items ? schema.items.properties : schema.properties;
  const required = schema.items ? schema.items.required : schema.required;
  out.tables[p.replace(/^\//, "")] = {
    columns: props ? Object.keys(props) : [],
    required: required || [],
    schema_ref: schema.$ref || (schema.items ? schema.items.$ref : null),
  };
}

fs.mkdirSync(path.join(process.cwd(), "out"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "out", "openapi_meta.json"), JSON.stringify(out, null, 2));
console.log("tables:", Object.keys(out.tables).length, "rpcs:", Object.keys(out.rpcs).length);
for (const [t, v] of Object.entries(out.tables)) console.log(`  ${t}: [${v.columns.join(", ")}]`);