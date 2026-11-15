import { createAdminClient, prisma } from "@/lib/supabase/admin";
import { fetchProviderServices } from "@/lib/smm/provider";

export interface JanjezService {
  id: string;
  name: string;
  slug: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  selling_price_ksh: number;
  provider_service_id: string | null;
  min_quantity: number;
  max_quantity: number;
  is_active: boolean;
  display_order: number;
  supports_drip_feed: boolean;
  supports_refill: boolean;
  supports_cancel: boolean;
  show_sidebar: boolean;
  show_landing: boolean;
  show_guarded: boolean;
  show_anonymous: boolean;
  show_catalogue: boolean;
  created_at: string;
  updated_at: string;
}

export type ServiceTier = "champion" | "premium" | "enterprise";

export interface TierInfo {
  tier: ServiceTier;
  label: string;
  description: string;
  maxPrice: number;
  color: string;
  href: string;
}

export const TIERS: TierInfo[] = [
  { tier: "champion", label: "Champion", description: "Budget-friendly essentials â€” under KES 2,000", maxPrice: 2000, color: "bg-kenya-green", href: "/services/champion" },
  { tier: "premium", label: "Premium", description: "Mid-tier services â€” KES 2,000 to KES 6,000", maxPrice: 6000, color: "bg-blue-500", href: "/services/premium" },
  { tier: "enterprise", label: "Enterprise", description: "High-volume solutions â€” above KES 6,000", maxPrice: Infinity, color: "bg-kenya-red", href: "/services/enterprise" },
];

export function getServiceTier(price: number): ServiceTier {
  if (price <= 2000) return "champion";
  if (price <= 6000) return "premium";
  return "enterprise";
}

export function getTierInfo(tier: ServiceTier): TierInfo | undefined {
  return TIERS.find((t) => t.tier === tier);
}

export function filterServicesByTier(services: JanjezService[], tier: ServiceTier): JanjezService[] {
  if (tier === "champion") return services.filter((s) => s.selling_price_ksh <= 2000);
  if (tier === "premium") return services.filter((s) => s.selling_price_ksh > 2000 && s.selling_price_ksh <= 6000);
  return services.filter((s) => s.selling_price_ksh > 6000);
}

export function getTierHref(tier: ServiceTier): string { return getTierInfo(tier)?.href ?? "/services"; }
export function getServiceTierHref(price: number): string { return getTierHref(getServiceTier(price)); }

export interface ProviderServiceRow {
  id: string;
  name: string;
  type: string | null;
  category: string | null;
  rate: number;
  min: number;
  max: number;
  refill: boolean;
  cancel: boolean;
  supports_drip_feed: boolean;
  is_active: boolean;
  fetched_at: string;
  raw: unknown;
}

function sqlEscape(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

export async function listProviderServices(params: {
  search?: string;
  category?: string;
  supportsDripFeed?: boolean;
}): Promise<ProviderServiceRow[]> {
  const conditions: string[] = [];
  if (params.search) {
    const s = sqlEscape(`%${params.search}%`);
    conditions.push(`("name" ILIKE ${s} OR "id" ILIKE ${s})`);
  }
  if (params.category) {
    conditions.push(`"category" ILIKE ${sqlEscape(`%${params.category}%`)}`);
  }
  if (params.supportsDripFeed) {
    conditions.push(`"supports_drip_feed" = true`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await prisma.$queryRawUnsafe(`
    SELECT "id","name","type","category","rate","min","max","refill","cancel",
           "supports_drip_feed","is_active","fetched_at","raw"
    FROM "provider_services" ${where} ORDER BY "rate" ASC
  `);
  return (rows as unknown as ProviderServiceRow[]) || [];
}

export async function listJanjezServices(activeOnly: boolean = false, placement?: keyof Pick<JanjezService, "show_sidebar" | "show_landing" | "show_guarded" | "show_anonymous" | "show_catalogue">): Promise<JanjezService[]> {
  const conditions: string[] = [];
  if (activeOnly) conditions.push('"is_active" = true');
  if (placement) conditions.push(`"${placement}" = true`);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      "id", "name", "slug", "category", "subcategory", "description",
      "selling_price_ksh", "janzez_service_id", "provider_service_id",
      "min_quantity", "max_quantity", "is_active", "display_order",
      "supports_drip_feed", "supports_refill", "supports_cancel",
      "show_sidebar", "show_landing", "show_guarded", "show_anonymous",
      "show_catalogue", "created_at", "updated_at"
    FROM "janzez_services"
    ${whereClause}
    ORDER BY "display_order" ASC, "created_at" DESC
  `);
  return (rows as unknown as JanjezService[]) || [];
}

export async function getJanjezService(id: string): Promise<JanjezService | null> {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT "id","name","slug","category","subcategory","description",
           "selling_price_ksh","janzez_service_id","provider_service_id",
           "min_quantity","max_quantity","is_active","display_order",
           "supports_drip_feed","supports_refill","supports_cancel",
           "show_sidebar","show_landing","show_guarded","show_anonymous",
           "show_catalogue","created_at","updated_at"
    FROM "janzez_services" WHERE "id" = ${sqlEscape(id)}::uuid LIMIT 1
  `);
  const arr = rows as unknown as JanjezService[];
  return arr?.[0] || null;
}

export async function createJanjezService(input: {
  name: string; slug: string; category: string; subcategory?: string; description?: string;
  selling_price_ksh: number; provider_service_id?: string | null; min_quantity: number; max_quantity: number;
  is_active?: boolean; display_order?: number; supports_drip_feed?: boolean; supports_refill?: boolean;
  supports_cancel?: boolean; show_sidebar?: boolean; show_landing?: boolean; show_guarded?: boolean;
  show_anonymous?: boolean; show_catalogue?: boolean; janzez_service_id?: string;
}): Promise<JanjezService | { error: string }> {
  try {
    const slug = normalizeSlug(input.slug);
    const janzezId = input.janzez_service_id || slug;
    const rows = await prisma.$queryRawUnsafe(`
      INSERT INTO "janzez_services" (
        "id","janzez_service_id","provider_service_id","name","slug","category","subcategory","description",
        "selling_price_ksh","min_quantity","max_quantity","is_active","display_order",
        "supports_drip_feed","supports_refill","supports_cancel","show_sidebar","show_landing",
        "show_guarded","show_anonymous","show_catalogue","created_at","updated_at"
      ) VALUES (
        gen_random_uuid(), ${sqlEscape(janzezId)}, ${sqlEscape(input.provider_service_id ?? janzezId)},
        ${sqlEscape(input.name)}, ${sqlEscape(slug)}, ${sqlEscape(input.category)}, ${sqlEscape(input.subcategory ?? null)},
        ${sqlEscape(input.description ?? null)}, ${sqlEscape(input.selling_price_ksh)}, ${sqlEscape(input.min_quantity)},
        ${sqlEscape(input.max_quantity)}, ${sqlEscape(input.is_active ?? true)}, ${sqlEscape(input.display_order ?? 0)},
        ${sqlEscape(input.supports_drip_feed ?? false)}, ${sqlEscape(input.supports_refill ?? false)},
        ${sqlEscape(input.supports_cancel ?? false)}, ${sqlEscape(input.show_sidebar ?? false)},
        ${sqlEscape(input.show_landing ?? false)}, ${sqlEscape(input.show_guarded ?? true)},
        ${sqlEscape(input.show_anonymous ?? true)}, ${sqlEscape(input.show_catalogue ?? true)}, now(), now()
      ) RETURNING *
    `);
    const arr = rows as unknown as JanjezService[];
    return arr[0];
  } catch (e: any) {
    return { error: e?.message || "Failed to create service" };
  }
}

export async function updateJanjezService(id: string, input: Record<string, any>): Promise<JanjezService | { error: string }> {
  try {
    const map: Record<string,string> = {
      name:'name', slug:'slug', category:'category', subcategory:'subcategory', description:'description',
      selling_price_ksh:'selling_price_ksh', provider_service_id:'provider_service_id',
      min_quantity:'min_quantity', max_quantity:'max_quantity', is_active:'is_active',
      display_order:'display_order', supports_drip_feed:'supports_drip_feed', supports_refill:'supports_refill',
      supports_cancel:'supports_cancel', show_sidebar:'show_sidebar', show_landing:'show_landing',
      show_guarded:'show_guarded', show_anonymous:'show_anonymous', show_catalogue:'show_catalogue',
      janzez_service_id:'janzez_service_id'
    };
    const sets: string[] = [];
    for (const [k,v] of Object.entries(input)) {
      if (v === undefined) continue;
      const col = map[k];
      if (!col) continue;
      sets.push(`"${col}" = ${sqlEscape(v)}`);
    }
    if (!sets.length) return { error: "No fields to update" };
    sets.push(`"updated_at" = now()`);
    const rows = await prisma.$queryRawUnsafe(`
      UPDATE "janzez_services" SET ${sets.join(", ")} WHERE "id" = ${sqlEscape(id)}::uuid RETURNING *
    `);
    const arr = rows as unknown as JanjezService[];
    if (!arr[0]) return { error: "Not found" };
    return arr[0];
  } catch (e: any) {
    return { error: e?.message || "Failed to update service" };
  }
}

export async function deleteJanjezService(id: string): Promise<void | { error: string }> {
  try {
    await prisma.$executeRawUnsafe(`UPDATE "janzez_services" SET "is_active" = false, "updated_at" = now() WHERE "id" = ${sqlEscape(id)}::uuid`);
  } catch (e: any) {
    return { error: e?.message || "Failed to delete service" };
  }
}

export function normalizeSlug(input: string): string {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "service";
}

export async function getProviderCatalogFresh(): Promise<ProviderServiceRow[]> {
  const services = await fetchProviderServices();
  return services.map((s) => ({
    id: String(s.service), name: s.name, type: s.type, category: s.category,
    rate: parseFloat(s.rate), min: parseInt(s.min, 10), max: parseInt(s.max, 10),
    refill: s.refill, cancel: s.cancel, supports_drip_feed: s.dripfeed === true,
    is_active: true, fetched_at: new Date().toISOString(), raw: s,
  }));
}
