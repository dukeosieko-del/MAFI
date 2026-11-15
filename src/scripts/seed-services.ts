import { PrismaClient } from "@prisma/client";
import { ORDER_SERVICES } from "@/lib/data";
import { SERVICE_CATALOG } from "@/lib/service-catalog";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function findSubcategory(svc: { categoryId: string; name: string; id: string }): string | null {
  for (const catalogItem of SERVICE_CATALOG) {
    if (catalogItem.id === svc.categoryId) {
      for (const sub of catalogItem.subcategories) {
        const match = sub.deliverables.find(
          (d: any) => d.name === svc.name || d.name === svc.id
        );
        if (match) {
          return sub.name;
        }
      }
    }
  }
  return null;
}

function normalizeSlug(input: string): string {
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

  let created = 0;

  for (const svc of ORDER_SERVICES) {
    const slug = normalizeSlug(`${svc.categoryId}-${svc.id}`);
    const subcategory = findSubcategory(svc);
    const supportsRefill = svc.refill !== "No refill";

    await prisma.$executeRawUnsafe(`
      INSERT INTO "janzez_services" (
        "janzez_service_id", "name", "slug", "category", "subcategory",
        "description", "selling_price_ksh", "min_quantity", "max_quantity",
        "is_active", "display_order", "supports_drip_feed", "supports_refill",
        "supports_cancel", "show_sidebar", "show_landing", "show_guarded",
        "show_anonymous", "show_catalogue", "created_at", "updated_at"
      ) VALUES (
        gen_random_uuid(),
        ${sqlEscape(svc.id)},
        ${sqlEscape(svc.name)},
        ${sqlEscape(slug)},
        ${sqlEscape(svc.categoryId)},
        ${sqlEscape(subcategory)},
        ${sqlEscape(svc.description || null)},
        ${sqlEscape(svc.rate)},
        ${sqlEscape(svc.min)},
        ${sqlEscape(svc.max)},
        true,
        0,
        false,
        ${supportsRefill},
        false,
        false,
        false,
        true,
        true,
        true,
        now(),
        now()
      )
    `);
    created++;
  }

  return { created, total: ORDER_SERVICES.length };
}
