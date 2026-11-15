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
    const keys = Object.keys(prisma);
    const janzezKeys = keys.filter((k: string) => k.toLowerCase().includes("janzez"));
    const allKeys = keys.filter((k: string) => !k.startsWith("_"));
    
    // Try count on janzezService
    let countResult: any = null;
    let countError: any = null;
    if ((prisma as any).janzezService) {
      try {
        countResult = await (prisma as any).janzezService.count();
      } catch (e: any) {
        countError = e.message;
      }
    }

    return NextResponse.json({
      hasPrisma: !!prisma,
      prismaKeys: allKeys,
      janzezKeys,
      janzezServiceExists: !!(prisma as any).janzezService,
      countResult,
      countError,
      databaseUrlSet: !!process.env.DATABASE_URL,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
