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
  const BATCH_SIZE = 500;

  for (let i = 0; i < services.length; i += BATCH_SIZE) {
    const batch = services.slice(i, i + BATCH_SIZE);
    const rows: any[] = [];

    for (const svc of batch) {
      const baseSlug = normalizeSlug(`${svc.category}-${svc.id}`);
      let slug = baseSlug;
      let counter = 1;
      while (slugSet.has(slug)) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
      slugSet.add(slug);

      rows.push({
        janzevServiceId: svc.id ?? null,
        name: svc.name ?? null,
        slug,
        category: svc.category ?? null,
        subcategory: svc.subcategory ?? null,
        description: null,
        sellingPriceKsh: svc.rate ?? 0,
        minQuantity: svc.min ?? 1,
        maxQuantity: svc.max ?? 1000000,
        isActive: svc.is_active ?? true,
        displayOrder: 0,
        supportsDripFeed: svc.supports_drip_feed ?? false,
        supportsRefill: svc.refill ?? false,
        supportsCancel: svc.cancel ?? false,
        showSidebar: false,
        showLanding: false,
        showGuarded: true,
        showAnonymous: true,
        showCatalogue: true,
      });
    }

    await (prisma as any).janzevService.createMany({
      data: rows,
      skipDuplicates: true,
    });
    created += rows.length;
  }

  return { created, total: services.length };
}
