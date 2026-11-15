import { createAdminClient, prisma } from "@/lib/supabase/admin";
import { getBusinessSideAccountId } from "./config";

export async function getBusinessSideAccount() {
  const accountId = getBusinessSideAccountId();
  if (!accountId) return { ok: false as const, code: "SERVER_MISCONFIGURED" as const };

  const account = await prisma.profiles.findFirst({
    where: { id: accountId },
    select: { id: true, wallet_balance: true, email: true },
  });

  if (!account) return { ok: false as const, code: "BUSINESS_ACCOUNT_NOT_FOUND" as const };
  return { ok: true as const, account };
}
