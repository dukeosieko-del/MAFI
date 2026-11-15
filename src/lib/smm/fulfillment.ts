import { createAdminClient, prisma } from "@/lib/supabase/admin";
import {
  fetchProviderServices,
  placeProviderOrder,
  getProviderMultipleStatus,
  createProviderRefill,
  createProviderCancel,
  getProviderBalance,
} from "./provider";
import type { ProviderService } from "./provider";
import { sendEmail } from "@/lib/email/mailer";
import { getOrderCompletedEmail, getOrderFailedEmail } from "@/lib/email/templates";
import { createNotification } from "@/lib/notifications";
import { creditWallet } from "@/lib/wallet";

function sqlEscape(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [60, 300, 900]; // 1min, 5min, 15min

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

async function maybeSendOrderStatusEmail(
  order: { id: string; order_id?: string | null; userId: string | null; service_name?: string | null; subcategory?: string | null; link_submitted?: string | null; link?: string | null; fulfillment_error?: string | null },
  prevStatus: string | null,
  newStatus: string
) {
  if (!order.userId) return;
  if (newStatus === prevStatus) return;

  try {
    const supabase = createAdminClient();
    if (!supabase) return;
    const { data: authUser } = await supabase.auth.admin.getUserById(order.userId);
    const email = authUser?.user?.email;
    if (!email) return;
    const profileMeta = (authUser?.user?.user_metadata as { full_name?: string } | undefined) || {};
    const fullName = profileMeta.fullName || null;
    const orderLabel = order.order_id || order.id.slice(0, 8);
    const serviceName = order.serviceName || order.subcategory || "Service";
    const link = order.linkSubmitted || order.link || "";

    if (newStatus === "fulfilled") {
      const { subject, html, text } = getOrderCompletedEmail({
        customerName: fullName,
        orderId: orderLabel,
        service: serviceName,
        link,
      });
      fireAndForgetEmail(
        sendEmail({ to: { address: email, name: fullName || "" }, subject, html, text }),
        "order-completed"
      );
    } else if (newStatus === "failed" || newStatus === "cancelled") {
      const { subject, html, text } = getOrderFailedEmail({
        customerName: fullName,
        orderId: orderLabel,
        reason: order.fulfillmentError || `Order ${newStatus}`,
        link,
      });
      fireAndForgetEmail(
        sendEmail({ to: { address: email, name: fullName || "" }, subject, html, text }),
        "order-failed"
      );
    }
  } catch (err) {
    console.error("[email] status email lookup threw:", err);
  }
}

export async function syncProviderCatalog() {
  const supabase = createAdminClient();
  if (!supabase) {
    throw new Error("Server misconfigured");
  }

  const services = await fetchProviderServices();

  for (const s of services) {
    await prisma.providerService.upsert({
      where: { id: String(s.service) },
      create: {
        id: String(s.service),
        name: s.name,
        type: s.type,
        category: s.category,
        rate: parseFloat(s.rate),
        min: parseInt(s.min, 10),
        max: parseInt(s.max, 10),
        refill: s.refill,
        cancel: s.cancel,
        supportsDripFeed: s.dripfeed === true,
        is_active: true,
        raw: s as any,
        fetched_at: new Date(),
      },
      update: {
        name: s.name,
        type: s.type,
        category: s.category,
        rate: parseFloat(s.rate),
        min: parseInt(s.min, 10),
        max: parseInt(s.max, 10),
        refill: s.refill,
        cancel: s.cancel,
        supportsDripFeed: s.dripfeed === true,
        is_active: true,
        raw: s as any,
        fetched_at: new Date(),
      },
    });
  }

  const providerIds = new Set(services.map((s) => String(s.service)));
  await prisma.providerService.updateMany({
    where: { id: { notIn: Array.from(providerIds) } },
    data: { is_active: false, fetched_at: new Date() },
  });

  return { count: services.length };
}

export async function getProviderServices(): Promise<ProviderService[]> {
  const supabase = createAdminClient();
  if (!supabase) return [];

  const services = await prisma.providerService.findMany({
    orderBy: { rate: "asc" },
  });

  return services as unknown as ProviderService[];
}

export interface JanjezServiceWithProvider {
  id: string;
  name: string;
  sellingPriceKsh: number;
  providerServiceId: string | null;
  minQuantity: number;
  maxQuantity: number;
  supportsDripFeed: boolean;
  supportsRefill: boolean;
  supportsCancel: boolean;
  category: string;
  subcategory: string | null;
  slug: string;
  description: string | null;
}

export async function resolveJanjezService(
  skuId?: string | null,
  catalogCategoryId?: string | null,
  janzezServiceId?: string | null
): Promise<JanjezServiceWithProvider | null> {
  const supabase = createAdminClient();
  if (!supabase) return null;

  const conditions: string[] = ['"is_active" = true'];
  if (janzezServiceId) {
    conditions.push(`"janzez_service_id" = ${sqlEscape(janzezServiceId)}`);
  } else if (skuId) {
    conditions.push(`"slug" = ${sqlEscape(skuId)}`);
  } else if (catalogCategoryId) {
    conditions.push(`"category" = ${sqlEscape(catalogCategoryId)}`);
  } else {
    return null;
  }

  const whereClause = conditions.join(" AND ");

  const data = await prisma.$queryRawUnsafe(`
    SELECT
      "id", "name", "slug", "category", "subcategory", "description",
      "selling_price_ksh", "janzez_service_id" as "provider_service_id",
      "min_quantity", "max_quantity", "supports_drip_feed", "supports_refill",
      "supports_cancel"
    FROM "janzez_services"
    WHERE ${whereClause}
    LIMIT 1
  `);

  const rows = data as unknown as any[];
  if (!rows || rows.length === 0) return null;
  return rows[0] as unknown as JanzevServiceWithProvider;
}

export async function fulfillOrder(orderId: string) {
  const supabase = createAdminClient();
  if (!supabase) {
    throw new Error("Server misconfigured");
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId },
  });

  if (!order) {
    throw new Error("Order not found");
  }

  if (order.providerOrderId) {
    return { status: "already_fulfilled", providerOrderId: order.providerOrderId };
  }

  if (process.env.SMM_FULFILLMENT_ENABLED === "false") {
    const message = "Fulfillment is disabled";
    await logFulfillment(orderId, "place", "fulfillment_disabled", null, null, message);
    await prisma.order.update({
      where: { id: orderId },
      data: { fulfillmentStatus: "fulfillment_disabled", fulfillmentError: message },
    });
    throw new Error(message);
  }

  // Check retry count
  const retryCount = order.retryCount || 0;
  if (retryCount >= MAX_RETRIES) {
    const message = "Max retries exceeded";
    await logFulfillment(order.id, "place", "failed", null, null, message);
    await prisma.order.update({
      where: { id: order.id },
      data: { fulfillmentStatus: "failed", fulfillmentError: message },
    });
    throw new Error(message);
  }

  const category = order.category || "";
  const subcategory = order.subcategory || "";
  const sku = order.skuId || order.serviceName || "";

  let providerService: ProviderService | null = null;
  let resolvedService: JanzezServiceWithProvider | null = null;
  let quantity = order.quantity || 1;
  let providerRate = 0;

  const janzezService = await resolveJanjezService(order.skuId, order.catalogCategoryId, order.janjez_service_id);
  if (janzezService && janzezService.providerServiceId) {
    resolvedService = janzezService;
    const providerData = await prisma.providerService.findFirst({
      where: { id: janzezService.providerServiceId },
    });

    if (providerData) {
      providerService = {
        service: parseInt(providerData.id, 10),
        name: providerData.name,
        type: providerData.type,
        category: providerData.category,
        rate: String(providerData.rate),
        min: String(providerData.min),
        max: String(providerData.max),
        refill: providerData.refill,
        cancel: providerData.cancel,
        dripfeed: providerData.supportsDripFeed,
      };
      providerRate = parseFloat(providerData.rate);
      quantity = Math.min(
        Math.max(order.quantity || 1, parseInt(providerData.min, 10)),
        parseInt(providerData.max, 10)
      );
    }
  }

  if (!providerService) {
    await logFulfillment(order.id, "place", "failed", null, null, "No provider mapping found for this service. Assign a provider_service_id to the Janjez service.");
    await prisma.order.update({
      where: { id: order.id },
      data: { fulfillmentStatus: "failed", fulfillmentError: "No provider mapping found for this service. Contact support." },
    });
    throw new Error("No provider mapping found for this service");
  }

  if (!providerRate) {
    providerRate = parseFloat(providerService.rate);
  }

  const expectedCharge = (providerRate * quantity) / 1000;
  try {
    const balance = await getProviderBalance();
    const providerBalance = parseFloat((balance as { balance?: string } | undefined)?.balance || "0");
    if (providerBalance < expectedCharge) {
      const message = `Insufficient provider balance: ${providerBalance} USD (need ${expectedCharge} USD)`;
      await logFulfillment(order.id, "place", "failed", null, null, message);
      await prisma.order.update({
        where: { id: order.id },
        data: { fulfillmentStatus: "failed", fulfillmentError: message },
      });
      throw new Error(message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider balance check failed";
    await logFulfillment(order.id, "place", "error", null, null, message);
    await prisma.order.update({
      where: { id: order.id },
      data: { fulfillmentStatus: "failed", fulfillmentError: message },
    });
    throw new Error(message);
  }

  let response: { order?: number; error?: string } = {};
  try {
    response = await placeProviderOrder({
      service: providerService.service,
      link: order.linkSubmitted || "",
      quantity,
      ...(order.runs != null ? { runs: order.runs } : {}),
      ...(order.interval != null ? { interval: order.interval } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider request failed";
    await handleFulfillmentFailure(order, message, retryCount);
    throw new Error(message);
  }

  if (response.order) {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        providerServiceId: String(providerService.service),
        providerOrderId: String(response.order),
        provider_status: "pending",
        providerCharge: expectedCharge,
        providerCurrency: "USD",
        fulfillmentStatus: "processing",
        fulfilled_at: new Date(),
      },
    });

    await logFulfillment(order.id, "place", "processing", { order: response.order }, { service: providerService.service });
    return { status: "processing", providerOrderId: String(response.order) };
  }

  const message = response.error || "Provider returned no order ID";
  await handleFulfillmentFailure(order, message, retryCount);
  throw new Error(message);
}

async function handleFulfillmentFailure(
  order: { id: string; order_id?: string | null; user_id?: string | null },
  errorMessage: string,
  retryCount: number
) {
  const nextRetryCount = retryCount + 1;
  const isRetryable = nextRetryCount < MAX_RETRIES;
  const newStatus = isRetryable ? "retry_pending" : "failed";
  const delay = isRetryable ? RETRY_DELAYS[nextRetryCount - 1] || 900 : 0;
  const nextRetryAt = isRetryable ? new Date(Date.now() + delay * 1000) : null;

  await logFulfillment(order.id as string, "place", newStatus, null, null, errorMessage);
  await prisma.order.update({
    where: { id: order.id },
    data: {
      fulfillmentStatus: newStatus,
      fulfillmentError: errorMessage,
      retryCount: nextRetryCount,
      nextRetryAt: nextRetryAt,
    },
  });

  // Refund on final failure (not retryable)
  if (!isRetryable) {
    await refundOrder(order, errorMessage);
  }

  // Send admin notification
  await notifyAdminsOfFailure(order, errorMessage);
}

async function refundOrder(
  order: { user_id?: string | null; amount_paid?: number | null; id: string },
  errorMessage: string
) {
  const userId = order.userId;
  const amountPaid = order.amountPaid;

  if (userId && amountPaid && amountPaid > 0) {
    try {
      await creditWallet(userId, amountPaid);
      await prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus: "refunded" },
      });
      console.log(`[fulfillment] Refunded ${amountPaid} to user ${userId} for order ${order.id}`);
    } catch (refundError) {
      console.error(`[fulfillment] Failed to refund user ${userId} for order ${order.id}:`, refundError);
      await logFulfillment(order.id, "refund", "error", null, { errorMessage }, `Refund failed: ${refundError}`);
    }
  }
}

async function notifyAdminsOfFailure(
  order: { id: string; order_id?: string | null; user_id?: string | null },
  errorMessage: string
) {
  try {
    await createNotification({
      userId: order.userId as string,
      audience: "admin",
      category: "fulfillment_failure",
      severity: "critical",
      title: `Fulfillment Failed: Order ${order.order_id || order.id.slice(0, 8)}`,
      body: `Order ${order.order_id || order.id.slice(0, 8)} failed fulfillment: ${errorMessage}`,
      link: `/admin/orders/${order.id}`,
    });
  } catch (notifyError) {
    console.error("[fulfillment] Admin notification failed:", notifyError);
  }
}

export async function cancelOrder(orderId: string) {
  const supabase = createAdminClient();
  if (!supabase) {
    throw new Error("Server misconfigured");
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId },
  });

  if (!order) {
    throw new Error("Order not found");
  }

  if (!order.providerOrderId) {
    return { status: "not_fulfilled", error: "Order has no provider order to cancel" };
  }

  const janzezServiceId = order.janjez_service_id;
  let resolvedService: JanzezServiceWithProvider | null = null;

  if (janzezServiceId) {
    resolvedService = await resolveJanjezService(null, null, janzezServiceId);
  }

  if (!resolvedService) {
    return { status: "error", error: "Unable to resolve service for cancellation" };
  }

  if (!resolvedService.supportsCancel) {
    return { status: "cancel_not_supported", error: "This service does not support cancellation" };
  }

  try {
    await createProviderCancel([String(order.providerOrderId)]);
    await prisma.order.update({
      where: { id: order.id },
      data: {
        fulfillmentStatus: "cancelled",
        provider_status: "Cancelled",
        status: "cancelled",
      },
    });
    await logFulfillment(order.id, "cancel", "cancelled", { order_id: order.providerOrderId }, null);
    return { status: "cancelled" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider cancellation failed";
    await logFulfillment(order.id, "cancel", "error", { order_id: order.providerOrderId }, null, message);
    return { status: "error", error: message };
  }
}

export async function refillOrder(orderId: string) {
  const supabase = createAdminClient();
  if (!supabase) {
    throw new Error("Server misconfigured");
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId },
  });

  if (!order) {
    throw new Error("Order not found");
  }

  if (!order.providerOrderId) {
    return { status: "not_fulfilled", error: "Order has no provider order to refill" };
  }

  const janzezServiceId = order.janjez_service_id;
  let resolvedService: JanzezServiceWithProvider | null = null;

  if (janzezServiceId) {
    resolvedService = await resolveJanjezService(null, null, janzezServiceId);
  }

  if (!resolvedService) {
    return { status: "error", error: "Unable to resolve service for refill" };
  }

  if (!resolvedService.supportsRefill) {
    return { status: "refill_not_supported", error: "This service does not support refill" };
  }

  try {
    await createProviderRefill([String(order.providerOrderId)]);
    await prisma.order.update({
      where: { id: order.id },
      data: { provider_status: "Pending" },
    });
    await logFulfillment(order.id, "refill", "processing", { order_id: order.providerOrderId }, null);
    return { status: "refill_submitted" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider refill failed";
    await logFulfillment(order.id, "refill", "error", { order_id: order.providerOrderId }, null, message);
    return { status: "error", error: message };
  }
}

function mapProviderStatus(status: string | null | undefined): "fulfilled" | "cancelled" | "processing" {
  if (!status) return "processing";
  const upper = status.trim();
  if (upper === "Completed") return "fulfilled";
  if (upper === "Cancelled" || upper === "Refunded") return "cancelled";
  if (upper === "Partial") return "processing";
  if (upper === "Pending" || upper === "In Progress" || upper === "Processing") return "processing";
  return "processing";
}

export { mapProviderStatus };

export async function syncOrderStatuses(orderIds?: string[]) {
  const supabase = createAdminClient();
  if (!supabase) return;

  const orders = await prisma.order.findMany({
    where: {
      providerOrderId: { not: null },
      ...(orderIds && orderIds.length > 0 ? { id: { in: orderIds } } : { fulfillmentStatus: { in: ["pending", "processing"] } }),
    },
    select: { id: true, order_id: true, userId: true, providerOrderId: true, fulfillmentStatus: true, provider_status: true, serviceName: true, subcategory: true, linkSubmitted: true, link: true, fulfillmentError: true },
  });

  if (!orders || orders.length === 0) return;

  const statuses = await getProviderMultipleStatus(
    orders.map((o) => o.providerOrderId as string)
  );

  for (const order of orders) {
    const status = statuses[order.providerOrderId as string];
    if (!status) continue;

    const mapped = mapProviderStatus(status.status);
    const unknown = !["Completed", "Cancelled", "Refunded", "Partial", "Pending", "In Progress", "Processing"].includes(status.status || "");

    const updates: Record<string, unknown> = {
      provider_status: status.status || null,
      providerStartCount: status.start_count || null,
      providerRemains: status.remains || null,
      providerCharge: status.charge ? parseFloat(status.charge) : null,
      providerCurrency: status.currency || "USD",
      fulfillmentStatus: mapped,
    };

    const prevStatus = order.fulfillmentStatus;
    const newStatus = updates.fulfillmentStatus as string;
    if (prevStatus !== newStatus || status.status !== order.provider_status) {
      if (unknown) {
        console.warn(`Unknown provider status "${status.status}" for order ${order.id} (${order.order_id})`);
      }
      await prisma.notification.create({
        data: {
          userId: order.userId as string,
          type: "order_update",
          title: `Order ${order.order_id || order.id.slice(0, 8)} status updated`,
          message: `Status changed from ${prevStatus || "pending"} to ${newStatus}. Provider: ${status.status || "unknown"}.`,
          link: "/orders/all",
        },
      });

      // Admin notification on failure/cancellation
      if (newStatus === "failed" || newStatus === "cancelled") {
        await createNotification({
          userId: order.userId as string,
          audience: "admin",
          category: "fulfillment_failure",
          severity: "critical",
          title: `Fulfillment ${newStatus === "failed" ? "Failed" : "Cancelled"}: Order ${order.order_id || order.id.slice(0, 8)}`,
          body: `Order ${order.order_id || order.id.slice(0, 8)} ${newStatus}: ${status.status || "unknown"}`,
          link: `/admin/orders/${order.id}`,
        });
      }
    }

    await prisma.order.update({
      where: { id: order.id },
      data: updates,
    });
    fireAndForgetEmail(
      maybeSendOrderStatusEmail(order, prevStatus || null, newStatus).then(
        () => ({ ok: true })
      ),
      "order-status-sync"
    );
    if (unknown) {
      await logFulfillment(order.id, "status", "unknown_status", null, status, `Unknown provider status: ${status.status}`);
    } else {
      await logFulfillment(order.id, "status", "synced", null, status);
    }
  }
}

export async function requestRefill(orderId: string) {
  const supabase = createAdminClient();
  if (!supabase) throw new Error("Server misconfigured");

  const order = await prisma.order.findFirst({
    where: { id: orderId },
    select: { providerOrderId: true, providerServiceId: true },
  });

  if (!order?.providerOrderId) {
    throw new Error("Order not fulfilled yet");
  }

  const result = await createProviderRefill([order.providerOrderId]);
  const refillResult = result[0];

  if (refillResult && typeof refillResult.refill === "number") {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        fulfillmentStatus: "processing",
        provider_status: "refilled",
        fulfilled_at: new Date(),
      },
    });
    await logFulfillment(orderId, "refill", "requested", { order: order.providerOrderId }, refillResult);
    return { refillId: refillResult.refill };
  }

  const message =
    typeof refillResult?.refill === "object" && refillResult.refill && "error" in refillResult.refill
      ? refillResult.refill.error
      : "Refill failed";

  await logFulfillment(orderId, "refill", "failed", { order: order.providerOrderId }, refillResult, message);
  throw new Error(message);
}

export async function requestCancel(orderId: string) {
  const supabase = createAdminClient();
  if (!supabase) throw new Error("Server misconfigured");

  const order = await prisma.order.findFirst({
    where: { id: orderId },
    select: { providerOrderId: true },
  });

  if (!order?.providerOrderId) {
    throw new Error("Order not fulfilled yet");
  }

  const result = await createProviderCancel([order.providerOrderId]);
  const cancelResult = result[0];

  if (cancelResult && typeof cancelResult.cancel === "number") {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        fulfillmentStatus: "cancelled",
        provider_status: "cancelled",
      },
    });
    await logFulfillment(orderId, "cancel", "cancelled", { order: order.providerOrderId }, cancelResult);
    return { cancelId: cancelResult.cancel };
  }

  const message =
    typeof cancelResult?.cancel === "object" && cancelResult.cancel && "error" in cancelResult.cancel
      ? cancelResult.cancel.error
      : "Cancel failed";

  await logFulfillment(orderId, "cancel", "failed", { order: order.providerOrderId }, cancelResult, message);
  throw new Error(message);
}

async function logFulfillment(
  orderId: string,
  action: string,
  status: string,
  requestPayload: Record<string, unknown> | null,
  responsePayload: unknown,
  error?: string
) {
  await prisma.fulfillmentLog.create({
    data: {
      order_id: orderId,
      action,
      status,
      request_payload: requestPayload,
      response_payload: responsePayload as any,
      error: error || null,
    },
  });
}
