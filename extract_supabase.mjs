/**
 * Read-only Supabase extractor.
 * Uses the service-role REST API to dump every public table's rows,
 * plus auth users, and storage bucket/object metadata.
 * Output: ./out/ directory of JSON files. NOTHING is written back to Supabase.
 */
import fs from "fs";
import path from "path";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rousjavuooduvicaobuv.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY required");

const OUT = path.join(process.cwd(), "out");
fs.mkdirSync(OUT, { recursive: true });

const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

async function getJson(u, extra = {}) {
  const r = await fetch(u, { headers: { ...H, ...extra } });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { j = { _raw: t, _status: r.status }; }
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${u}: ${t.slice(0,300)}`);
  return j;
}

// 1. OpenAPI to discover tables
const openapi = await getJson(`${URL}/rest/v1/`, { Accept: "application/openapi+json" });
const allPaths = Object.keys(openapi.paths || {});
const rpcs = allPaths.filter(p => p.startsWith("/rpc/")).map(p => p.replace("/rpc/", ""));
const allTables = allPaths
  .filter(p => !p.startsWith("/rpc/") && p !== "/")
  .sort();
console.log("Discovered tables:", allTables.length);
console.log(allTables.join(", "));
console.log("RPC functions:", rpcs.join(", "));

// 2. Dump every table (paginated via limit/offset)
const results = {};
for (const t of allTables) {
  const rows = [];
  let offset = 0;
  const PAGE = 1000;
  for (;;) {
    const u = `${URL}/rest/v1/${t}?select=*&limit=${PAGE}&offset=${offset}`;
    const data = await getJson(u);
    if (!Array.isArray(data)) {
      console.log(`  ${t}: non-array response, storing raw`);
      results[t] = { kind: "raw", value: data };
      break;
    }
    if (data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  results[t] = { kind: "rows", count: rows.length, rows };
  console.log(`  ${t}: ${rows.length} rows`);
}

fs.writeFileSync(path.join(OUT, "public_tables.json"), JSON.stringify(results, null, 2));
console.log("Wrote public_tables.json");

// 3. Auth users (admin endpoint)
try {
  const users = [];
  let page = 1;
  for (;;) {
    const u = `${URL}/auth/v1/admin/users?per_page=100&page=${page}`;
    const data = await getJson(u);
    if (!Array.isArray(data) || data.length === 0) break;
    users.push(...data);
    if (data.length < 100) break;
    page++;
  }
  fs.writeFileSync(path.join(OUT, "auth_users.json"), JSON.stringify(users, null, 2));
  console.log(`auth_users: ${users.length}`);
} catch (e) {
  console.log("auth_users error:", e.message);
}

// 4. Storage buckets + objects
try {
  const buckets = await getJson(`${URL}/storage/v1/bucket`);
  fs.writeFileSync(path.join(OUT, "storage_buckets.json"), JSON.stringify(buckets, null, 2));
  console.log("storage_buckets:", buckets.length);
  const objs = {};
  for (const b of buckets) {
    try {
      const o = await getJson(`${URL}/storage/v1/object/list/${encodeURIComponent(b.id)}?limit=1000&offset=0`);
      objs[b.id] = o;
      console.log(`  bucket ${b.id}: ${o.length} objects`);
    } catch (e) { objs[b.id] = { error: e.message }; }
  }
  fs.writeFileSync(path.join(OUT, "storage_objects.json"), JSON.stringify(objs, null, 2));
} catch (e) {
  console.log("storage error:", e.message);
}

// 5. JWT config (for the integration guide)
fs.writeFileSync(path.join(OUT, "openapi.json"), JSON.stringify(openapi, null, 2));
console.log("DONE");