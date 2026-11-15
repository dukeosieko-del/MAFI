import { NextResponse, NextRequest } from "next/server";
import { createAdminClient, prisma } from "@/lib/supabase/admin";
import { listJanjezServices } from "@/lib/janzez-services";
import { rateLimit } from "@/lib/server/rate-limiter";
import { validateLink, validateNumber, sanitizeString } from "@/lib/server/validation";
import { calculateOrderCost, calculateMpesaAmount } from "@/lib/pricing";
import { getCallbackUrl, initiateStkPush } from "@/lib/mpesa/client";
import { sendEmail } from "@/lib/email/mailer";
import { getOrderReceivedEmail } from "@/lib/email/templates";
import { SITE_URL } from "@/lib/email/config";

export const runtime = "nodejs";

function validateDripFeedField(value: unknown, name: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (isNaN(num) || !Number.isInteger(num) || num < 1) return `${name} must be a positive integer`;
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const rl = rateLimit(request, 20);
  if (!rl.ok && rl.response) return rl.response;

  try {
    const body = await request.json();
    const {
      janzez_service_id,
      link_submitted,
      quantity,
      phone_number,
      runs,
      interval,
      email,
    } = body as {
      janzez_service_id?: string;
      link_submitted?: string;
      quantity?: number;
      phone_number?: string;
      runs?: number | null;
      interval?: number | null;
      email?: string;
    };

    const errors: string[] = [];

    if (!janzez_service_id) errors.push("janzez_service_id is required");
    if (!phone_number || !/^\d{9,15}$/.test(phone_number.replace(/\s+/g, ""))) {
      errors.push("A valid phone number is required");
    }
    if (email !== undefined && email !== null && email !== "" && !EMAIL_RE.test(email)) {
      errors.push("A valid email address is required when provided");
    }

    const quantityErr = validateNumber(quantity, "quantity", { min: 1 });
    if (quantityErr) errors.push(quantityErr);

    const linkErr = validateLink(link_submitted);
    if (linkErr) errors.push(linkErr);

    const runsErr = validateDripFeedField(runs, "runs");
    if (runsErr) errors.push(runsErr);

    const intervalErr = validateDripFeedField(interval, "interval");
    if (intervalErr) errors.push(intervalErr);

    if (errors.length > 0) {
      return NextResponse.json({ error: "Validation failed", details: errors }, { status: 400 });
    }

    const supabase = createAdminClient();
    if (!supabase) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const numQuantity = Number(quantity);

    const services = await listJanjezServices(true, "show_anonymous");
    const janjezService = services.find((s) => s.id === janzez_service_id) || null;
    if (!janjezService) {
      return NextResponse.json({ error: "Service not found or not available" }, { status: 404 });
    }

    if (!janjezService.providerServiceId) {
      return NextResponse.json({ error: "Service is not configured for ordering. Please try another service." }, { status: 400 });
    }

    if (numQuantity < janjezService.minQuantity || numQuantity > janjezService.maxQuantity) {
      return NextResponse.json({
        error: `Quantity must be between ${janjezService.minQuantity} and ${janjezService.maxQuantity.toLocaleString()}.`,
      }, { status: 400 });
    }

    if ((runs != null || interval != null) && !janjezService.supportsDripFeed) {
      return NextResponse.json({ error: "This service does not support drip-feed" }, { status: 400 });
    }

    const expectedAmount = calculateOrderCost(janjezService.sellingPriceKsh, numQuantity);

    if (isNaN(expectedAmount) || expectedAmount <= 0) {
      return NextResponse.json({ error: "Unable to verify service price" }, { status: 400 });
    }

    const orderId = `ORD-${Date.now().toString(36).toUpperCase()}`;
    const amountForMpesa = calculateMpesaAmount(expectedAmount);

    const orderData = await prisma.order.create({
      data: {
        order_id: orderId,
        userId: null,
        phoneNumber: sanitizeString(phone_number || "", 30),
        anonymous: true,
        category: janjezService.category,
        subcategory: janjezService.subcategory || janjezService.name,
        serviceName: janjezService.name,
        skuId: janjezService.slug,
        janzez_service_id,
        linkSubmitted: sanitizeString(link_submitted, 500),
        link: sanitizeString(link_submitted ?? "", 500),
        quantity: numQuantity,
        amount: expectedAmount,
        amountPaid: amountForMpesa,
        quantitySource: "preset",
        status: "pending",
        paymentStatus: "pending_mpesa",
        fulfillmentStatus: "pending",
        runs: runs ?? null,
        interval: interval ?? null,
      },
      select: { id: true, order_id: true },
    });

    if (!orderData) {
      console.error("Anonymous order insert error: no data returned");
      return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }

    const sanitizedEmail = email && EMAIL_RE.test(email) ? sanitizeString(email, 254) : null;
    if (sanitizedEmail) {
      const linkValue = sanitizeString(link_submitted, 500) ?? "";
      const { subject, html, text } = getOrderReceivedEmail({
        customerName: null,
        orderId: orderData.order_id || orderData.id.slice(0, 8),
        service: janjezService.name,
        quantity: numQuantity,
        amount: expectedAmount,
        link: linkValue,
      });
      sendEmail({
        to: { address: sanitizedEmail },
        subject,
        html,
        text,
      })
        .then((result) => {
          if (!result.ok) {
            console.error("[email] anonymous order-received failed:", result.error);
          }
        })
        .catch((err) => {
          console.error("[email] anonymous order-received threw:", err);
        });
    }

    const callbackUrl = getCallbackUrl(SITE_URL);

    try {
      const stkRes = await initiateStkPush({
        phoneNumber: phone_number!,
        amount: amountForMpesa,
        callbackUrl,
        accountReference: orderId,
        transactionDesc: `Anonymous order payment for ${janjezService.name}`,
      });

      await prisma.walletTransaction.create({
        data: {
          userId: null,
          phoneNumber: sanitizeString(phone_number || "", 30),
          type: "order_payment",
          amount: amountForMpesa,
          currency: "KES",
          paymentMethod: "mpesa",
          mpesaPhone: phone_number,
          reference: stkRes.CheckoutRequestID,
          relatedOrderId: orderData.id,
          status: "pending",
          notes: `Anonymous order STK for ${orderId}`,
        },
      });

      return NextResponse.json({
        ok: true,
        order_id: orderData.order_id,
        checkoutRequestId: stkRes.CheckoutRequestID,
        amount: expectedAmount,
        amountForMpesa,
        message: stkRes.CustomerMessage || "STK push initiated. Check your phone.",
      });
    } catch (stkError) {
      console.error("Anonymous STT push error:", stkError);
      const stkErrorMsg = stkError instanceof Error ? stkError.message : "Unknown error";
      await prisma.order.update({
        where: { id: orderData.id },
        data: {
          fulfillmentStatus: "failed",
          fulfillmentError: `M-Pesa payment initiation failed: ${stkErrorMsg}`,
        },
      });
      return NextResponse.json({
        ok: false,
        order_id: orderData.order_id,
        error: "Payment gateway not configured. Please contact support.",
      }, { status: 200 });
    }
  } catch (error) {
    console.error("Anonymous order error:", error);
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
