import { prisma } from "@/lib/supabase/admin";
import { ORDER_SERVICES } from "@/lib/data";
import { SERVICE_CATALOG } from "@/lib/service-catalog";
import { normalizeSlug } from "@/lib/janjez-services";

function findSubcategory(svc: (typeof ORDER_SERVICES)[number]): string | null {
  for (const catalogItem of SERVICE_CATALOG) {
    if (catalogItem.id === svc.categoryId) {
      for (const sub of catalogItem.subcategories) {
        const match = sub.deliverables.find(
          (d) => d.name === svc.name || d.name === svc.id
        );
        if (match) {
          return sub.name;
        }
      }
    }
  }
  return null;
}

export async function seedServices() {
  let created = 0;
  let skipped = 0;

  for (const svc of ORDER_SERVICES) {
    const slug = normalizeSlug(`${svc.categoryId}-${svc.id}`);

    const existing = await prisma.JanzezService.findUnique({ where: { slug } });
    if (existing) {
      skipped++;
      continue;
    }

    const subcategory = findSubcategory(svc);

    await prisma.JanzezService.create({
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

if (require.main === module) {
  seedServices()
    .then((result) => {
      console.log(
        `Seeded ${result.created} services (${result.skipped} skipped, ${result.total} total).`
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
