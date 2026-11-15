/**
 * Final comprehensive extraction:
 * - auth users (paginated properly)
 * - storage objects
 * - full column/type metadata from OpenAPI definitions
 * - row counts per table
 */
import fs from "fs";
import path from "path";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rousjavuooduvicaobuv.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
const OUT = path.join(process.cwd(), "out");
fs.mkdirSync(OUT, { recursive: true });

// Auth users
const users = [];
let page = 1;
for (;;) {
  const r = await fetch(`${URL}/auth/v1/admin/users?per_page=100&page=${page}`, { headers: H });
  const arr = await r.json();
  const list = Array.isArray(arr) ? arr : (arr.users || []);
  if (list.length === 0) break;
  users.push(...list);
  if (list.length < 100) break;
  page++;
}
fs.writeFileSync(path.join(OUT, "auth_users.json"), JSON.stringify(users, null, 2));
console.log("auth_users:", users.length);

// Storage
const buckets = await (await fetch(`${URL}/storage/v1/bucket`, { headers: H })).json();
const objs = {};
for (const b of buckets) {
  try {
    const r = await fetch(`${URL}/storage/v1/object/list/${b.id}?limit=1000&offset=0`, { headers: H });
    const o = await r.json();
    objs[b.id] = Array.isArray(o) ? o : { error: JSON.stringify(o) };
    console.log(`bucket ${b.id}:`, objs[b.id].length, "objects");
  } catch (e) { objs[b.id] = { error: e.message }; }
}
fs.writeFileSync(path.join(OUT, "storage_buckets.json"), JSON.stringify(buckets, null, 2));
fs.writeFileSync(path.join(OUT, "storage_objects.json"), JSON.stringify(objs, null, 2));

// OpenAPI definitions for column metadata
const j = await (await fetch(`${URL}/rest/v1/`, { headers: { ...H, Accept: "application/openapi+json" } })).json();
const meta = {};
for (const [name, def] of Object.entries(j.definitions || {})) {
  meta[name] = {
    columns: Object.keys(def.properties || {}),
    required: def.required || [],
  };
}
fs.writeFileSync(path.join(OUT, "openapi_definitions.json"), JSON.stringify(meta, null, 2));
console.log("definitions:", Object.keys(meta).length);

// Row counts from public_tables.json
const pub = JSON.parse(fs.readFileSync(path.join(OUT, "public_tables.json"), "utf8"));
const counts = {};
for (const [t, v] of Object.entries(pub)) counts[t] = v.count || 0;
fs.writeFileSync(path.join(OUT, "row_counts.json"), JSON.stringify(counts, null, 2));
console.log("row_counts:", JSON.stringify(counts));
console.log("TOTAL public rows:", Object.values(counts).reduce((a,b)=>a+b,0));