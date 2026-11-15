import { createAdminClient, prisma } from "@/lib/supabase/admin";
import { getCallbackUrl, initiateStkPush } from "@/lib/mpesa/client";
import { getBusinessSideAccountId } from "./config";
import { withIdempotency } from "./idempotency";

function normalizePhone(value: string) {
  return value.replace(/\s+/g, "");
}

export async function topUpBusinessWallet(input: {
  amount: number;
  phoneNumber: string;
  idempotencyKey: string;
}) {
  const accountId = getBusinessSideAccountId();
  if (!accountId) {
    return { ok: false as const, code: "SERVER_MISCONFIGURED", message: "Business Side account is not configured." };
  }

  const account = await prisma.profiles.findFirst({
    where: { id: accountId },
    select: { id: true },
  });

  if (!account) {
    return { ok: false as const, code: "BUSINESS_ACCOUNT_NOT_FOUND", message: "Business Side account was not found." };
  }

  const existing = await prisma.wallet_transactions.findFirst({
    where: {
      user_id: accountId,
      type: "topup",
      notes: `business-side:${input.idempotencyKey}`,
    },
    select: { reference: true, status: true, amount: true },
  });

  if (existing?.reference) {
    return {
      ok: true as const,
      checkoutRequestId: existing.reference,
      status: existing.status,
      amount: Number(existing.amount),
      replayed: true,
    };
  }

  const stk = await initiateStkPush({
    phoneNumber: normalizePhone(input.phoneNumber),
    amount: input.amount,
    callbackUrl: getCallbackUrl(process.env.NEXT_PUBLIC_SITE_URL || "https://janjez.social"),
    accountReference: `business-side-${input.idempotencyKey}`,
    transactionDesc: "Business Side wallet top-up",
  }).catch((error: unknown) => ({
    error: error instanceof Error ? error.message : "M-Pesa STK push failed",
  }));

  if ("error" in stk) {
    return { ok: false as const, code: "MPESA_ERROR", message: stk.error };
  }

  await prisma.wallet_transactions.create({
    data: {
      user_id: accountId,
      type: "topup",
      amount: input.amount,
      currency: "KES",
      payment_method: "mpesa",
      mpesa_phone: normalizePhone(input.phoneNumber),
      reference: stk.CheckoutRequestID,
      status: "pending",
      notes: `business-side:${input.idempotencyKey}`,
    },
  });

  return {
    ok: true as const,
    checkoutRequestId: stk.CheckoutRequestID,
    status: "pending",
    amount: input.amount,
    replayed: false,
  };
}

export function runTopupIdempotent<T>(key: string, operation: () => Promise<T>) {
  return withIdempotency<T>(`business-topup:${key}`, 24 * 60 * 60 * 1000, operation);
}
