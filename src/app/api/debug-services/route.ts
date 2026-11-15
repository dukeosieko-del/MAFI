import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Test count
    const countResult = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) FROM "janzez_services"`
    );
    
    // Test full query (same as listJanjezServices)
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        "id", "name", "slug", "category", "subcategory", "description",
        "selling_price_ksh", "janzez_service_id" as "provider_service_id",
        "min_quantity", "max_quantity", "is_active", "display_order",
        "supports_drip_feed", "supports_refill", "supports_cancel",
        "show_sidebar", "show_landing", "show_guarded", "show_anonymous",
        "show_catalogue", "created_at", "updated_at"
      FROM "janzez_services"
      WHERE "is_active" = true AND "show_catalogue" = true
      ORDER BY "display_order" ASC, "created_at" DESC
    `);

    return NextResponse.json({
      count: countResult,
      rowCount: (rows as any[]).length,
      firstRow: (rows as any[]).slice(0, 2),
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
