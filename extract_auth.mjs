import fs from "fs";
import path from "path";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rousjavuooduvicaobuv.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
const OUT = path.join(process.cwd(), "out");
fs.mkdirSync(OUT, { recursive: true });

const users = [];
let page = 1;
let guard = 0;
while (guard++ < 50) {
  const r = await fetch(`${URL}/auth/v1/admin/users?per_page=100&page=${page}`, { headers: H });
  const t = await r.text();
  let arr;
  try { arr = JSON.parse(t); } catch { console.log("page", page, "non-json:", t.slice(0,200)); break; }
  const list = Array.isArray(arr) ? arr : (arr.users || []);
  if (list.length === 0) break;
  users.push(...list);
  console.log(`page ${page}: ${list.length} users (total ${users.length})`);
  if (list.length < 100) break;
  page++;
}
fs.writeFileSync(path.join(OUT, "auth_users.json"), JSON.stringify(users, null, 2));
console.log("TOTAL auth users:", users.length);
// summary
for (const u of users) console.log(`  ${u.id} ${u.email} confirmed=${!!u.email_confirmed_at} role=${u.role}`);