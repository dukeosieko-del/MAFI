import { calculateOrderCost } from "@/lib/pricing";
import { createAdminClient, prisma } from "@/lib/supabase/admin";
import { fulfillOrder, cancelOrder, refillOrder, type JanzejServiceWithProvider } from "@/lib/smm/fulfillment";
import { debitWallet, creditWallet } from "@/lib/wallet";
import { getBusinessSideAccountId } from "./config";
import { withIdempotency } from "./idempotency";
import type { BusinessOrderInput } from "./types";

function resolveInputService(input: BusinessOrderInput) {
  const janzejServiceId = input.janjezServiceId || input.serviceId || null;
  return {
    janzejServiceId,
    skuId: input.skuId || null,
    catalogCategoryId: input.catalogCategoryId || null,
  };
}

export async function createBusinessOrder(input: BusinessOrderInput, idempotencyKey: string) {
  const accountId = getBusinessSideAccountId();
  if (!accountId) {
    return { ok: false as const, code: "SERVER_MISCONFIGURED", message: "Business Side account is not configured." };
  }

  const quantity = Math.trunc(input.quantity);
  if (!Number.isFinite(input.quantity) || quantity !== input.quantity || quantity <= 0) {
    return { ok: false as const, code: "INVALID_QUANTITY", message: "Quantity must be a positive integer." };
  }

  const link = input.link.trim();
  if (!link) {
    return { ok: false as const, code: "INVALID_LINK", message: "Link is required." };
  }

  const service = await import("@/lib/smm/fulfillment").then(({ resolveJanjezService }) =>
    resolveJanjezService(
      resolveInputService(input).skuId,
      resolveInputService(input).catalogCategoryId,
      resolveInputService(input).janzejServiceId,
    ),
  );

  if (!service) {
    return { ok: false as const, code: "SERVICE_NOT_FOUND", message: "Janjez service was not found." };
  }

  if (quantity < service.minQuantity || quantity > service.maxQuantity) {
    return { ok: false as const, code: "INVALID_QUANTITY", message: "Quantity is outside the service limits." };
  }

  const existing = await prisma.order.findFirst({
    where: {
      userId: accountId,
      paymentReference: `business-side:${idempotencyKey}`,
    },
    select: { id: true, order_id: true, status: true, fulfillmentStatus: true, provider_status: true, providerOrderId: true, quantity: true, amount: true, link: true, linkSubmitted: true, createdAt: true, updatedAt: true },
  });

  if (existing) {
    return { ok: true as const, order: existing, fulfillment: null, replayed: true };
  }

  const amount = calculateOrderCost(service.sellingPriceKsh, quantity);
  const debit = await debitWallet(accountId, amount);

  if (!debit.success) {
    return { ok: false as const, code: "INSUFFICIENT_BALANCE", message: "Business Side wallet has insufficient funds." };
  }

  const orderReference = `business-side:${idempotencyKey}`;
  const inserted = await prisma.order.create({
    data: {
      userId: accountId,
      order_id: `BS-${Date.now().toString(36).toUpperCase()}`,
      category: service.category,
      subcategory: service.subcategory,
      skuId: service.slug,
      catalogCategoryId: service.category,
      janzejServiceId: service.id,
      providerServiceId: service.providerServiceId || null,
      serviceName: service.name,
      quantity,
      linkSubmitted: link,
      link,
      amount,
      amountPaid: amount,
      paymentStatus: "paid",
      status: "pending",
      fulfillmentStatus: "pending",
      paymentMethod: "wallet",
      paymentReference: orderReference,
      quantitySource: "preset",
      runs: input.runs ?? null,
      interval: input.interval ?? null,
    },
  });

  try {
    const fulfillment = await fulfillOrder(inserted.id);
    return { ok: true as const, order: inserted, fulfillment, replayed: false };
  } catch (error) {
    const latest = await prisma.order.findFirst({
      where: { id: inserted.id },
      select: { paymentStatus: true },
    });

    if (latest?.paymentStatus === "paid") {
      await creditWallet(accountId, amount);
      await prisma.order.update({
        where: { id: inserted.id },
        data: { paymentStatus: "refunded" },
      });
    }

    return {
      ok: false as const,
      code: "PROVIDER_ERROR",
      message: error instanceof Error ? error.message : "Provider fulfillment failed.",
    };
  }
}

export async function getBusinessOrder(orderId: string) {
  const accountId = getBusinessSideAccountId();
  if (!accountId) return null;

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: accountId },
  });

  return order;
}

export async function cancelBusinessOrder(orderId: string) {
  const order = await getBusinessOrder(orderId);
  if (!order) return { ok: false as const, code: "ORDER_NOT_FOUND", message: "Order was not found." };
  try {
    const result = await cancelOrder(orderId);
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      code: "PROVIDER_ERROR",
      message: error instanceof Error ? error.message : "Order cancellation failed.",
    };
  }
}

export async function refillBusinessOrder(orderId: string) {
  const order = await getBusinessOrder(orderId);
  if (!order) return { ok: false as const, code: "ORDER_NOT_FOUND", message: "Order was not found." };
  try {
    const result = await refillOrder(orderId);
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      code: "PROVIDER_ERROR",
      message: error instanceof Error ? error.message : "Order refill failed.",
    };
  }
}

export function runOrderCreationIdempotent<T>(key: string, operation: () => Promise<T>) {
  return withIdempotency<T>(`business-order:${key}`, 24 * 60 * 60 * 1000, operation);
}

export type { JanzejServiceWithProvider };
