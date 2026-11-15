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

export async function seedServices() {
  let created = 0;
  let skipped = 0;

  for (const svc of ORDER_SERVICES) {
    const slug = normalizeSlug(`${svc.categoryId}-${svc.id}`);

    const existing = await prisma.janzezService.findUnique({ where: { slug } });
    if (existing) {
      skipped++;
      continue;
    }

    const subcategory = findSubcategory(svc);

    await prisma.janzezService.create({
      data: {
        janzezServiceId: svc.id,
        name: svc.name,
        slug,
        category: svc.categoryId,
        subcategory,
        description: svc.description || null,
        sellingPriceKsh: svc.rate,
        minQuantity: svc.min,
        maxQuantity: svc.max,
        isActive: true,
        displayOrder: 0,
        supportsDripFeed: false,
        supportsRefill: svc.refill !== "No refill",
        supportsCancel: false,
        showSidebar: false,
        showLanding: false,
        showGuarded: true,
        showAnonymous: true,
        showCatalogue: true,
      },
    });
    created++;
  }

  return { created, skipped, total: ORDER_SERVICES.length };
}
