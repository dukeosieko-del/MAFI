import { NextResponse, NextRequest } from "next/server";
import { createAdminClient, prisma } from "@/lib/supabase/admin";
import { fulfillOrder, resolveJanjezService } from "@/lib/smm/fulfillment";
import { getUserFromRequest } from "@/lib/server/auth-helpers";
import { rateLimit } from "@/lib/server/rate-limiter";
import { validateLink, validateNumber, sanitizeString } from "@/lib/server/validation";
import { SERVICE_CATALOG } from "@/lib/service-catalog";
import { calculateOrderCost } from "@/lib/pricing";
import { debitWallet, creditWallet } from "@/lib/wallet";
import { sendEmail } from "@/lib/email/mailer";
import { getOrderReceivedEmail, getOrderFailedEmail, getLowWalletBalanceEmail } from "@/lib/email/templates";
import { SITE_URL } from "@/lib/email/config";

export const runtime = "nodejs";

const LOW_BALANCE_THRESHOLD_KES = 100;
const LOW_BALANCE_DEBOUNCE_MS = 24 * 60 * 60 * 1000;

function validateDripFeedField(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return `${field} must be an integer`;
  }
  if (value <= 0) {
    return `${field} must be greater than 0`;
  }
  return null;
}

function fireAndForgetEmail(
  promise: Promise<{ ok: boolean; error?: string }>,
  label: string
) {
  promise
    .then((result) => {
      if (!result.ok) {
        console.error(`[email] ${label} failed:`, result.error);
      }
    })
    .catch((err) => {
      console.error(`[email] ${label} threw:`, err);
    });
}

async function maybeSendLowBalanceEmail(
  userId: string,
  email: string,
  fullName: string | null,
  newBalance: number
) {
  if (newBalance >= LOW_BALANCE_THRESHOLD_KES) return;

  try {
    const profile = await prisma.profile.findFirst({
      where: { id: userId },
      select: { last_low_balance_email_at: true },
    });

    if (!profile) {
      console.error("[email] failed to read low-balance debounce: profile not found");
      return;
    }

    const lastSent = profile.last_low_balance_email_at
      ? new Date(profile.last_low_balance_email_at).getTime()
      : 0;
    if (lastSent && Date.now() - lastSent < LOW_BALANCE_DEBOUNCE_MS) {
      return;
    }

    const { subject, html, text } = getLowWalletBalanceEmail({
      fullName,
      balance: newBalance,
      topUpUrl: `${SITE_URL}/pay`,
    });
    const result = await sendEmail({
      to: { address: email, name: fullName || "" },
      subject,
      html,
      text,
    });
    if (result.ok) {
      await prisma.profile.update({
        where: { id: userId },
        data: { last_low_balance_email_at: new Date().toISOString() },
      });
    } else {
      console.error("[email] low-balance email failed:", result.error);
    }
  } catch (err) {
    console.error("[email] low-balance email threw:", err);
  }
}

function calculateExpectedAmount(
  catalogCategoryId: string | undefined,
  category: string,
  subcategory: string,
  skuId: string | null | undefined,
  quantity: number
): number {
  const catalogItem = SERVICE_CATALOG.find(
    (c) => c.id === catalogCategoryId || c.name === category
  );
  if (catalogItem) {
    const sub = catalogItem.subcategories.find((s) => s.name === subcategory);
    if (sub) {
      const deliverable = sub.deliverables.find((d) => d.name === skuId || d.name === sub.deliverables[0].name);
      if (deliverable) {
        const priceMatch = deliverable.price.match(/([\d,.]+)/);
        if (priceMatch) {
          const rate = parseFloat(priceMatch[1].replace(/,/g, ""));
          return calculateOrderCost(rate * 1000, quantity);
        }
      }
    }
  }

  return NaN;
}

export async function POST(request: NextRequest) {
  try {
    const rl = rateLimit(request, 30);
    if (!rl.ok && rl.response) return rl.response;

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
       order_id,
       category,
       subcategory,
       sku_id,
       quantity,
       link_submitted,
       amount_paid,
       catalog_category_id,
        payment_reference,
        refill_guarantee,
        quantity_source,
        runs,
        interval,
       janjez_service_id,
       payment_method,
    } = body as {
       order_id?: string;
       category?: string;
       subcategory?: string;
       sku_id?: string | null;
       quantity?: number;
       link_submitted?: string;
       amount_paid?: number;
       catalog_category_id?: string;
       payment_reference?: string;
       refill_guarantee?: string | null;
       quantity_source?: "preset" | "custom";
       runs?: number | null;
       interval?: number | null;
       janjez_service_id?: string | null;
       payment_method?: "wallet" | "mpesa";
     };

    const errors: string[] = [];

    if (!janjez_service_id) {
      if (!category) errors.push("category is required");
      if (!subcategory) errors.push("subcategory is required");
    }
    if (!quantity_source) errors.push("quantity_source is required");

    const quantityErr = validateNumber(quantity, "quantity", { min: 1 });
    if (quantityErr) errors.push(quantityErr);

    const linkErr = validateLink(link_submitted);
    if (linkErr) errors.push(linkErr);

    if (amount_paid === undefined || isNaN(Number(amount_paid)) || Number(amount_paid) < 0) {
      errors.push("amount_paid must be a non-negative number");
    }

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

    let expectedAmount: number;
    let janjezService = null;

    if (janjez_service_id) {
      janjezService = await resolveJanjezService(null, null, janjez_service_id);
      if (!janjezService) {
        return NextResponse.json({ error: "Service not found or not available" }, { status: 404 });
      }
      if (numQuantity < janjezService.min_quantity || numQuantity > janjezService.max_quantity) {
        return NextResponse.json({
          error: `Quantity must be between ${janjezService.min_quantity} and ${janjezService.max_quantity.toLocaleString()}.`,
        }, { status: 400 });
      }
      if (runs != null || interval != null) {
        if (!janjezService.supports_drip_feed) {
          return NextResponse.json({ error: "This service does not support drip-feed" }, { status: 400 });
        }
      }
      expectedAmount = calculateOrderCost(janjezService.selling_price_ksh, numQuantity);
    } else {
      expectedAmount = calculateExpectedAmount(
        catalog_category_id,
        category!,
        subcategory!,
        sku_id,
        numQuantity
      );
    }

    if (isNaN(expectedAmount) || expectedAmount <= 0) {
      return NextResponse.json({ error: "Unable to verify service price. Please try a different service." }, { status: 400 });
    }

    const clientAmount = Number(amount_paid) || 0;
    const tolerance = 0.01;
    if (Math.abs(expectedAmount - clientAmount) > tolerance) {
      console.error(`Order price mismatch: expected ${expectedAmount}, got ${clientAmount}`);
      return NextResponse.json({
        error: "Price verification failed. The submitted amount does not match the service price.",
      }, { status: 400 });
    }

    // Payment method: "wallet" (default) pays straight from the dashboard
    // balance, "mpesa" creates the order first and lets the M-Pesa callback
    // settle it (so the money follows the procedure the user initiated).
    const paymentMethod = payment_method === "mpesa" ? "mpesa" : "wallet";
    let newBalance = 0;

    if (paymentMethod === "wallet") {
      const debit = await debitWallet(supabase as any, user.id, expectedAmount);

      if (!debit.success) {
        const currentBalance = await prisma.profile.findFirst({
          where: { id: user.id },
          select: { wallet_balance: true },
        });
        const balance = Number(currentBalance?.wallet_balance) || 0;
        await prisma.notification.create({
          data: {
            user_id: user.id,
            type: "order_failed",
            title: "Order Failed - Insufficient Wallet Balance",
            message: `Your order could not be placed: insufficient wallet balance (KES ${balance.toFixed(2)}). Top up via M-Pesa first.`,
            link: "/pay",
          },
        });
        return NextResponse.json({
          error: "Insufficient wallet balance. Please top up your wallet before placing an order.",
        }, { status: 402 });
      }

      newBalance = debit.newBalance;
    }
    fireAndForgetEmail(
      maybeSendLowBalanceEmail(user.id, user.email, null, newBalance).then(
        () => ({ ok: true })
      ),
      "low-wallet-balance"
    );

    const orderData = await prisma.order.create({
      data: {
        user_id: user.id,
        order_id: order_id || undefined,
        category,
        subcategory,
        service_name: subcategory,
        sku_id: sku_id ?? janjezService?.slug ?? null,
        quantity: numQuantity,
        link_submitted: sanitizeString(link_submitted, 500),
        link: sanitizeString(link_submitted, 500) ?? "",
        amount: expectedAmount,
        amount_paid: expectedAmount,
        payment_reference: sanitizeString(payment_reference, 200) || null,
        refill_guarantee: refill_guarantee ?? null,
        quantity_source,
        catalog_category_id,
        janjez_service_id: janjez_service_id || null,
        status: "pending",
        payment_status: paymentMethod === "mpesa" ? "pending_mpesa" : "paid",
        fulfillment_status: "pending",
        runs: runs ?? null,
        interval: interval ?? null,
      },
    });

    // M-Pesa orders are settled by the M-Pesa callback: the order is already
    // created and linked (related_order_id) so the money follows the exact
    // procedure the customer started. Do not fulfil it here.
    if (paymentMethod === "mpesa") {
      return NextResponse.json({
        ok: true,
        order: orderData,
        mpesa: {
          amount: expectedAmount,
          order_id: orderData.order_id || orderData.id,
        },
      });
    }

    if (orderData.id) {
      try {
        const fulfillmentResult = await fulfillOrder(orderData.id);

        if (fulfillmentResult.status === "processing" || fulfillmentResult.status === "already_fulfilled") {
          await prisma.notification.create({
            data: {
              user_id: user.id,
              type: "order_fulfilled",
              title: "Order Accepted",
              message: `Your order ${orderData.order_id || orderData.id.slice(0, 8)} has been sent to the provider. Status: ${fulfillmentResult.status}.`,
              link: "/orders/all",
            },
          });
        }
      } catch (fulfillError) {
        console.error("Auto-fulfillment failed for order", orderData.id, fulfillError);
        const errorMessage = fulfillError instanceof Error ? fulfillError.message : "Auto-fulfillment error";
        await prisma.order.update({
          where: { id: orderData.id },
          data: {
            fulfillment_status: "failed",
            fulfillment_error: errorMessage,
          },
        });
        await prisma.notification.create({
          data: {
            user_id: user.id,
            type: "order_failed",
            title: "Order Fulfillment Failed",
            message: `Your order ${orderData.order_id || orderData.id.slice(0, 8)} could not be processed: ${errorMessage}.`,
            link: "/orders/all",
          },
        });

        try {
          const refund = await creditWallet(supabase as any, user.id, expectedAmount);
          if (refund.error) {
            console.error("Wallet refund failed for order", orderData.id, refund.error);
          }
        } catch (refundError) {
          console.error("Wallet refund failed for order", orderData.id, refundError);
        }

        fireAndForgetEmail(
          (async () => {
            const profile = await prisma.profile.findFirst({
              where: { id: user.id },
              select: { full_name: true },
            });
            const fullName = (profile?.full_name as string | null | undefined) || null;
            const { subject, html, text } = getOrderFailedEmail({
              customerName: fullName,
              orderId: orderData.order_id || orderData.id.slice(0, 8),
              reason: errorMessage,
              link: sanitizeString(link_submitted, 500) ?? "",
            });
            return sendEmail({
              to: { address: user.email, name: fullName || "" },
              subject,
              html,
              text,
            });
          })(),
          "order-failed"
        );
      }

      try {
        await prisma.notification.create({
          data: {
            user_id: user.id,
            type: "order_created",
            title: "Order Placed",
            message: `Your order ${orderData.order_id || orderData.id.slice(0, 8)} for ${subcategory} has been recorded.`,
            link: "/orders/all",
          },
        });
      } catch (notifErr) {
        console.error("Failed to create notification for order", orderData.id, notifErr);
      }

      fireAndForgetEmail(
        (async () => {
          const profile = await prisma.profile.findFirst({
            where: { id: user.id },
            select: { full_name: true },
          });
          const fullName = (profile?.full_name as string | null | undefined) || null;
          const { subject, html, text } = getOrderReceivedEmail({
            customerName: fullName,
            orderId: orderData.order_id || orderData.id.slice(0, 8),
            service: janjezService?.name || subcategory || "Service",
            quantity: numQuantity,
            amount: expectedAmount,
            link: sanitizeString(link_submitted, 500) ?? "",
          });
          return sendEmail({
            to: { address: user.email, name: fullName || "" },
            subject,
            html,
            text,
          });
        })(),
        "order-received"
      );
    }

    return NextResponse.json({ order: orderData }, { status: 201 });
  } catch (error) {
    console.error("Order creation error:", error);
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const rl = rateLimit(request, 60);
    if (!rl.ok && rl.response) return rl.response;

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orders = await prisma.order.findMany({
      where: { user_id: user.id },
      orderBy: { created_at: "desc" },
    });

    return NextResponse.json({ orders: orders || [] });
  } catch {
    return NextResponse.json({ error: "Failed to load orders" }, { status: 500 });
  }
}
