import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const prisma = globalForPrisma.prisma ?? new PrismaClient();
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

function loadJson(name: string): any[] {
  const dataPath = path.join(process.cwd(), "src/scripts", name);
  const raw = fs.readFileSync(dataPath, "utf-8");
  return JSON.parse(raw);
}

function sqlEscape(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function seedJanjezServices() {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "janzez_services" CASCADE`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "janzez_services" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "janzez_service_id" TEXT,
      "provider_service_id" TEXT,
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

  const services = loadJson("janjez_catalogue.json");
  let created = 0;
  const slugSet = new Set<string>();
  const BATCH_SIZE = 200;

  for (let i = 0; i < services.length; i += BATCH_SIZE) {
    const batch = services.slice(i, i + BATCH_SIZE);
    const valuesSql: string[] = [];

    for (const svc of batch) {
      const baseSlug = normalizeSlug(svc.slug || `${svc.category}-${svc.janzez_service_id}`);
      let slug = baseSlug;
      let counter = 1;
      while (slugSet.has(slug)) { slug = `${baseSlug}-${counter}`; counter++; }
      slugSet.add(slug);

      valuesSql.push(`(
        gen_random_uuid(),
        ${sqlEscape(svc.janzez_service_id)},
        ${sqlEscape(svc.provider_service_id ?? svc.janzez_service_id)},
        ${sqlEscape(svc.name)},
        ${sqlEscape(slug)},
        ${sqlEscape(svc.category)},
        ${sqlEscape(svc.subcategory)},
        ${sqlEscape(svc.description)},
        ${sqlEscape(svc.selling_price_ksh ?? 0)},
        ${sqlEscape(svc.min_quantity ?? 1)},
        ${sqlEscape(svc.max_quantity ?? 1000000)},
        ${sqlEscape(svc.is_active ?? true)},
        ${sqlEscape(svc.display_order ?? 0)},
        ${sqlEscape(svc.supports_drip_feed ?? false)},
        ${sqlEscape(svc.supports_refill ?? false)},
        ${sqlEscape(svc.supports_cancel ?? false)},
        ${sqlEscape(svc.show_sidebar ?? false)},
        ${sqlEscape(svc.show_landing ?? false)},
        ${sqlEscape(svc.show_guarded ?? true)},
        ${sqlEscape(svc.show_anonymous ?? true)},
        ${sqlEscape(svc.show_catalogue ?? true)},
        now(), now()
      )`);
    }

    const sql = `
      INSERT INTO "janzez_services" (
        "id", "janzez_service_id", "provider_service_id", "name", "slug", "category", "subcategory",
        "description", "selling_price_ksh", "min_quantity", "max_quantity",
        "is_active", "display_order", "supports_drip_feed", "supports_refill",
        "supports_cancel", "show_sidebar", "show_landing", "show_guarded",
        "show_anonymous", "show_catalogue", "created_at", "updated_at"
      ) VALUES ${valuesSql.join(",\n")}
    `;
    await prisma.$executeRawUnsafe(sql);
    created += batch.length;
  }
  return { created, total: services.length };
}

async function seedProviderServices() {
  // Ensure table exists (Prisma schema has it; create if missing)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "provider_services" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "type" TEXT,
      "category" TEXT,
      "rate" DECIMAL(10,5) NOT NULL,
      "min" INT NOT NULL,
      "max" INT NOT NULL,
      "refill" BOOLEAN DEFAULT false,
      "cancel" BOOLEAN DEFAULT false,
      "raw" JSONB,
      "fetched_at" TIMESTAMP WITH TIME ZONE DEFAULT now(),
      "provider_name" TEXT DEFAULT 'DripFeedPanel',
      "subcategory" TEXT,
      "supports_drip_feed" BOOLEAN DEFAULT false,
      "is_active" BOOLEAN DEFAULT true,
      "last_synced_at" TIMESTAMP WITH TIME ZONE DEFAULT now()
    )
  `);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "provider_services" CASCADE`);

  const services = loadJson("provider_services_data.json");
  let created = 0;
  const BATCH_SIZE = 200;
  for (let i = 0; i < services.length; i += BATCH_SIZE) {
    const batch = services.slice(i, i + BATCH_SIZE);
    const valuesSql: string[] = [];
    for (const svc of batch) {
      valuesSql.push(`(
        ${sqlEscape(String(svc.id))},
        ${sqlEscape(svc.name)},
        ${sqlEscape(svc.type)},
        ${sqlEscape(svc.category)},
        ${sqlEscape(svc.rate ?? 0)},
        ${sqlEscape(svc.min ?? 0)},
        ${sqlEscape(svc.max ?? 0)},
        ${sqlEscape(svc.refill ?? false)},
        ${sqlEscape(svc.cancel ?? false)},
        NULL,
        now(),
        ${sqlEscape(svc.provider_name ?? "DripFeedPanel")},
        ${sqlEscape(svc.subcategory)},
        ${sqlEscape(svc.supports_drip_feed ?? false)},
        ${sqlEscape(svc.is_active ?? true)},
        now()
      )`);
    }
    const sql = `
      INSERT INTO "provider_services" (
        "id","name","type","category","rate","min","max","refill","cancel","raw","fetched_at",
        "provider_name","subcategory","supports_drip_feed","is_active","last_synced_at"
      ) VALUES ${valuesSql.join(",\n")}
      ON CONFLICT ("id") DO NOTHING
    `;
    await prisma.$executeRawUnsafe(sql);
    created += batch.length;
  }
  return { created, total: services.length };
}

export async function seedServices() {
  const janjez = await seedJanjezServices();
  const provider = await seedProviderServices();
  return { janjez, provider };
}
