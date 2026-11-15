import { NextResponse, NextRequest } from "next/server";
import { initiateStkPush, getCallbackUrl } from "@/lib/mpesa/client";
import { createAdminClient, prisma } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/server/auth-helpers";
import { rateLimit } from "@/lib/server/rate-limiter";
import { calculateMpesaAmount } from "@/lib/pricing";
import { SITE_URL } from "@/lib/email/config";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rl = rateLimit(request, 20);
  if (!rl.ok && rl.response) return rl.response;

  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { phoneNumber, amount, orderId } = body as { phoneNumber?: string; amount?: number; orderId?: string };

  if (!phoneNumber || !amount || amount <= 0) {
    return NextResponse.json({ error: "Valid phone number and positive amount required" }, { status: 400 });
  }

  const numAmount = calculateMpesaAmount(Number(amount));

  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // When the payment settles an order, the order price is authoritative — the
  // client may not decide how much is charged.
  let chargeAmount = numAmount;
  let relatedOrderId: string | null = null;

  if (orderId) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, user_id: user.id },
      select: { id: true, amount: true, amount_paid: true, payment_status: true },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (order.payment_status === "paid") {
      return NextResponse.json({ error: "This order has already been paid" }, { status: 409 });
    }

    const expected = Number(order.amount_paid ?? order.amount) || 0;
    if (expected <= 0) {
      return NextResponse.json({ error: "Order has no payable amount" }, { status: 400 });
    }

    chargeAmount = calculateMpesaAmount(expected);
    relatedOrderId = order.id;
  }

  try {
    const callbackUrl = getCallbackUrl(SITE_URL);
    const response = await initiateStkPush({
      phoneNumber,
      amount: chargeAmount,
      callbackUrl,
      accountReference: relatedOrderId
        ? `janjez-order-${relatedOrderId.slice(0, 8)}`
        : `janjez-topup-${user.id.slice(0, 8)}`,
      transactionDesc: relatedOrderId
        ? `Order payment for ${relatedOrderId.slice(0, 8)}`
        : `Wallet top-up for ${user.email}`,
    });

    await prisma.walletTransaction.create({
      data: {
        user_id: user.id,
        type: relatedOrderId ? "order_payment" : "topup",
        amount: chargeAmount,
        currency: "KES",
        payment_method: "mpesa",
        mpesa_phone: phoneNumber,
        reference: response.CheckoutRequestID,
        related_order_id: relatedOrderId,
        status: "pending",
        notes: relatedOrderId ? "M-Pesa STK push initiated for order" : "M-Pesa STK push initiated",
      },
    });

    if (relatedOrderId) {
      await prisma.order.update({
        where: { id: relatedOrderId },
        data: { payment_status: "pending_mpesa" },
      });
    }

    return NextResponse.json({
      ok: true,
      checkoutRequestId: response.CheckoutRequestID,
      amount: chargeAmount,
      orderId: relatedOrderId,
      message: response.CustomerMessage || "STK push initiated. Check your phone.",
    });
  } catch (error) {
    console.error("M-Pesa STK push error:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to initiate M-Pesa payment",
    }, { status: 500 });
  }
}
