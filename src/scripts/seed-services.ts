import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/, "") || "service";
}

function sqlEscape(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

function loadProviderData(): any[] {
  const dataPath = path.join(process.cwd(), "src/scripts/provider_services_data.json");
  const raw = fs.readFileSync(dataPath, "utf-8");
  return JSON.parse(raw);
}

export async function seedServices() {
  // Create table if it doesn't exist
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "janzez_services" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "janzez_service_id" TEXT,
      "name" TEXT,
      "slug" TEXT UNIQUE,
      "category" TEXT,
      "subcategory" TEXT,
      "description" TEXT,
      "selling_price_ksh" DECIMAL(10,2),
      "min_quantity" INT,
      "max_quantity" INT,
      "is_active" BOOLEAN DEFAULT true,
      "display_order" INT DEFAULT 0,
      "supports_drip_feed" BOOLEAN DEFAULT false,
      "supports_refill" BOOLEAN DEFAULT false,
      "supports_cancel" BOOLEAN DEFAULT false,
      "show_sidebar" BOOLEAN DEFAULT false,
      "show_landing" BOOLEAN DEFAULT false,
      "show_guarded" BOOLEAN DEFAULT true,
      "show_anonymous" BOOLEAN DEFAULT true,
      "show_catalogue" BOOLEAN DEFAULT true,
      "created_at" TIMESTAMP DEFAULT now(),
      "updated_at" TIMESTAMP DEFAULT now()
    )
  `);

  // Clear existing services to avoid duplicates
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "janzez_services" RESTART IDENTITY CASCADE`);

  const services = loadProviderData();
  let created = 0;
  const slugSet = new Set<string>();

  for (const svc of services) {
    const baseSlug = normalizeSlug(`${svc.category}-${svc.id}`);
    let slug = baseSlug;
    let counter = 1;
    while (slugSet.has(slug)) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    slugSet.add(slug);

    const sellingPriceKsh = svc.rate !== null && svc.rate !== undefined ? svc.rate : 0;

    await prisma.$executeRawUnsafe(`
      INSERT INTO "janzez_services" (
        "id", "janzev_service_id", "name", "slug", "category", "subcategory",
        "description", "selling_price_ksh", "min_quantity", "max_quantity",
        "is_active", "display_order", "supports_drip_feed", "supports_refill",
        "supports_cancel", "show_sidebar", "show_landing", "show_guarded",
        "show_anonymous", "show_catalogue", "created_at", "updated_at"
      ) VALUES (
        gen_random_uuid(),
        ${sqlEscape(svc.id)},
        ${sqlEscape(svc.name)},
        ${sqlEscape(slug)},
        ${sqlEscape(svc.category)},
        ${sqlEscape(svc.subcategory)},
        NULL,
        ${sqlEscape(sellingPriceKsh)},
        ${sqlEscape(svc.min !== null && svc.min !== undefined ? svc.min : 1)},
        ${sqlEscape(svc.max !== null && svc.max !== undefined ? svc.max : 1000000)},
        ${sqlEscape(svc.is_active !== null && svc.is_active !== undefined ? svc.is_active : true)},
        0,
        ${sqlEscape(svc.supports_drip_feed !== null && svc.supports_drip_feed !== undefined ? svc.supports_drip_feed : false)},
        ${sqlEscape(svc.refill !== null && svc.refill !== undefined ? svc.refill : false)},
        ${sqlEscape(svc.cancel !== null && svc.cancel !== undefined ? svc.cancel : false)},
        false,
        false,
        true,
        true,
        true,
        true,
        now(),
        now()
      )
    `);
    created++;
  }

  return { created, total: services.length };
}
