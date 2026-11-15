import { NextResponse, NextRequest } from "next/server";
import { createAdminClient, prisma } from "@/lib/supabase/admin";
import { completeStkPayment, StkCallbackMetadata } from "@/lib/mpesa/client";
import { rateLimit } from "@/lib/server/rate-limiter";
import { sendEmail } from "@/lib/email/mailer";
import { getPaymentReceivedEmail } from "@/lib/email/templates";
import { SITE_URL } from "@/lib/email/config";

export const runtime = "nodejs";

interface MpesaCallbackBody {
  CheckoutRequestID?: string;
  ResponseCode?: string;
  ResultCode?: string;
  ResultDesc?: string;
  ResponseDescription?: string;
  CallbackMetadata?: {
    Item: Array<{ Name: string; Value?: string }>;
  };
}

function extractMetadata(body: MpesaCallbackBody): StkCallbackMetadata {
  const items = body?.CallbackMetadata?.Item || [];
  if (!Array.isArray(items)) return {};
  const get = (name: string): string | undefined =>
    items.find((i: { Name: string; Value?: string }) => i.Name === name)?.Value;
  return {
    amount: get("Amount") ? Number(get("Amount")) : undefined,
    phone: get("PhoneNumber"),
    receipt: get("ReceiptNumber") || get("MpesaReceiptNumber"),
  };
}

export async function POST(request: NextRequest) {
  const rl = rateLimit(request, 30);
  if (!rl.ok && rl.response) return rl.response;

  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const body = await request.json() as MpesaCallbackBody;
  const checkoutRequestID = body?.CheckoutRequestID;

  if (!checkoutRequestID) {
    return NextResponse.json({ error: "Missing CheckoutRequestID" }, { status: 400 });
  }

  const responseCode = body?.ResponseCode || (body as Record<string, unknown>)?.ResponseCode?.toString();
  const resultCode = body?.ResultCode?.toString() || (responseCode === "0" ? "0" : "999");
  const resultType = (body as Record<string, unknown>)?.ResultType?.toString();

  if (resultCode !== "0") {
    await prisma.walletTransaction.updateMany({
      where: { reference: checkoutRequestID, status: "pending" },
      data: {
        status: "failed",
        notes: body?.ResultDesc || body?.ResponseDescription || "M-Pesa payment failed",
      },
    });
    return NextResponse.json({ ok: true, resultCode, credited: false });
  }

  const metadata = extractMetadata(body);

  try {
    const result = await completeStkPayment(checkoutRequestID, metadata);
    if (result.amount > 0) {
      try {
        const pendingTx = await prisma.walletTransaction.findFirst({
          where: { reference: checkoutRequestID },
          select: { userId: true, reference: true },
        });
        const txUserId = pendingTx?.userId;
        if (txUserId) {
          const { data: authUser } = await supabase.auth.admin.getUserById(txUserId);
          const email = authUser?.user?.email;
          if (email) {
            const fullName =
              ((authUser?.user?.user_metadata as { full_name?: string } | undefined)?.fullName) || null;
            const { subject, html, text } = getPaymentReceivedEmail({
              customerName: fullName,
              amount: result.amount,
              method: "M-Pesa",
              reference: pendingTx?.reference || checkoutRequestID,
              link: `${SITE_URL}/wallet`,
            });
            const emailResult = await sendEmail({
              to: { address: email, name: fullName || "" },
              subject,
              html,
              text,
            });
            if (!emailResult.ok) {
              console.error("[email] payment-received failed:", emailResult.error);
            }
          }
        }
      } catch (emailErr) {
        console.error("[email] payment-received threw:", emailErr);
      }
    }
  } catch (error) {
    console.error("Failed to complete STK payment:", error);
    // The money is already in Safaricom's hands: keep the transaction PENDING
    // (do not mark it failed) so the reconciliation job can retry the credit
    // instead of losing the deposit. A 500 also makes Safaricom redeliver.
    await prisma.walletTransaction.updateMany({
      where: { reference: checkoutRequestID, status: "pending" },
      data: {
        notes: `Wallet credit pending retry: ${error instanceof Error ? error.message : String(error)}`,
      },
    });
    return NextResponse.json({ error: "Payment received but wallet credit failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, resultCode, resultType, credited: true });
}

export async function GET() {
  return NextResponse.json({ message: "M-Pesa callback endpoint. POST your callback data here." });
}
