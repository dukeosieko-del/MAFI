import { NextResponse, NextRequest } from "next/server";
import { createAdminClient, prisma } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    if (!supabase) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const count = Math.max(1, Math.min(10, parseInt(searchParams.get("count") || "1", 10)));

    const services = await prisma.janjez_services.findMany({
      select: { id: true, name: true, slug: true, category: true, subcategory: true, is_active: true, supports_drip_feed: true },
      where: { is_active: true, show_catalogue: true },
      orderBy: { id: "desc" },
    });

    const shuffled = services.sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, count);

    return NextResponse.json({ services: selected });
  } catch (error) {
    console.error("Happy Hour API error:", error);
    return NextResponse.json({ error: "Failed to find Happy Hour service" }, { status: 500 });
  }
}
