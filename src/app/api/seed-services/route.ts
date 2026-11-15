import { NextResponse } from "next/server";
import { seedServices } from "@/scripts/seed-services";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await seedServices();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("Seed API error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
