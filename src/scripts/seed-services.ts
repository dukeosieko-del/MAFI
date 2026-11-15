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

function loadProviderData(): any[] {
  const dataPath = path.join(process.cwd(), "src/scripts/provider_services_data.json");
  const raw = fs.readFileSync(dataPath, "utf-8");
  return JSON.parse(raw);
}

export async function seedServices() {
  // Drop and recreate table to ensure correct schema
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "janzez_services" CASCADE`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "janzez_services" (
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

  const services = loadProviderData();
  let created = 0;
  const slugSet = new Set<string>();
  const BATCH_SIZE = 100;

  for (let i = 0; i < services.length; i += BATCH_SIZE) {
    const batch = services.slice(i, i + BATCH_SIZE);
    const clauses: string[] = [];
    const values: any[] = [];

    for (const svc of batch) {
      const baseSlug = normalizeSlug(`${svc.category}-${svc.id}`);
      let slug = baseSlug;
      let counter = 1;
      while (slugSet.has(slug)) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
      slugSet.add(slug);

      const sellingPriceKsh = svc.rate ?? 0;
      const minQty = svc.min ?? 1;
      const maxQty = svc.max ?? 1000000;
      const isActive = svc.is_active ?? true;
      const supportsDripFeed = svc.supports_drip_feed ?? false;
      const supportsRefill = svc.refill ?? false;
      const supportsCancel = svc.cancel ?? false;

      const n = values.length;
      clauses.push(
        `(gen_random_uuid(), $${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, NULL, $${n + 6}, $${n + 7}, $${n + 8}, $${n + 9}, 0, $${n + 10}, $${n + 11}, $${n + 12}, false, false, true, true, true, now(), now())`
      );
      values.push(
        svc.id ?? null,
        svc.name ?? null,
        slug,
        svc.category ?? null,
        svc.subcategory ?? null,
        sellingPriceKsh,
        minQty,
        maxQty,
        isActive,
        supportsDripFeed,
        supportsRefill,
        supportsCancel
      );
    }

    // Build the full query with all parameter placeholders
    let query = `
      INSERT INTO "janzez_services" (
        "id", "janzez_service_id", "name", "slug", "category", "subcategory",
        "description", "selling_price_ksh", "min_quantity", "max_quantity",
        "is_active", "display_order", "supports_drip_feed", "supports_refill",
        "supports_cancel", "show_sidebar", "show_landing", "show_guarded",
        "show_anonymous", "show_catalogue", "created_at", "updated_at"
      ) VALUES ${clauses.join(",\n")}
    `;

    // Use $executeRawUnsafe with manually replaced parameters
    // Prisma $executeRaw tagged template doesn't work with dynamic clause count
    // so we use $executeRawUnsafe with properly escaped values
    let sql = query;
    for (let v = 0; v < values.length; v++) {
      const val = values[v];
      let escaped: string;
      if (val === null || val === undefined) {
        escaped = "NULL";
      } else if (typeof val === "boolean") {
        escaped = val ? "true" : "false";
      } else if (typeof val === "number") {
        escaped = String(val);
      } else {
        escaped = `'${String(val).replace(/'/g, "''")}'`;
      }
      sql = sql.replace(`$${v + 1}`, escaped);
    }

    await prisma.$executeRawUnsafe(sql);
    created += batch.length;
  }

  return { created, total: services.length };
}
