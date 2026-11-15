import { createAdminClient, prisma } from "@/lib/supabase/admin";
import { fetchProviderServices } from "@/lib/smm/provider";
import { getJanjezSellingPrice } from "@/lib/pricing";

const SERVICES_CACHE = new Map<string, { services: any[]; timestamp: number }>();
const SERVICES_CACHE_TTL_MS = 30_000;

export interface JanzejService {
  id: string;
  name: string;
  slug: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  selling_price_ksh: number;
  provider_service_id: string | null;
  min_quantity: number;
  max_quantity: number;
  is_active: boolean;
  display_order: number;
  supports_drip_feed: boolean;
  supports_refill: boolean;
  supports_cancel: boolean;
  show_sidebar: boolean;
  show_landing: boolean;
  show_guarded: boolean;
  show_anonymous: boolean;
  show_catalogue: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderServiceRow {
  id: string;
  name: string;
  type: string | null;
  category: string | null;
  rate: number;
  min: number;
  max: number;
  refill: boolean;
  cancel: boolean;
  supports_drip_feed: boolean;
  is_active: boolean;
  fetched_at: string;
  raw: unknown;
}

export async function listProviderServices(params: {
  search?: string;
  category?: string;
  supportsDripFeed?: boolean;
}): Promise<ProviderServiceRow[]> {
  const supabase = createAdminClient();
  if (!supabase) return [];

  let where: any = {};

  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: "insensitive" } },
      { id: { contains: params.search, mode: "insensitive" } },
    ];
  }

  if (params.category) {
    where.category = { contains: params.category, mode: "insensitive" };
  }

  if (params.supportsDripFeed) {
    where.supports_drip_feed = true;
  }

  const data = await prisma.providerService.findMany({
    where,
    orderBy: { rate: "asc" },
  });

  return (data || []) as unknown as ProviderServiceRow[];
}

export async function listJanjezServices(activeOnly: boolean = false, placement?: keyof Pick<JanzejService, "show_sidebar" | "show_landing" | "show_guarded" | "show_anonymous" | "show_catalogue">): Promise<JanzejService[]> {
  const supabase = createAdminClient();
  if (!supabase) return [];

  let where: any = {};

  if (activeOnly) {
    where.is_active = true;
  }

  if (placement) {
    where[placement] = true;
  }

  const cacheKey = `${activeOnly}:${placement ?? ""}`;
  const cached = SERVICES_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SERVICES_CACHE_TTL_MS) {
    return cached.services;
  }

  const all = await prisma.janjez_services.findMany({
    where,
    orderBy: [
      { display_order: "asc" },
      { created_at: "desc" },
    ],
  });

  SERVICES_CACHE.set(cacheKey, { services: all as unknown as JanzejService[], timestamp: Date.now() });
  return all as unknown as JanzejService[];
}

export async function getJanjezService(id: string): Promise<JanzejService | null> {
  const supabase = createAdminClient();
  if (!supabase) return null;

  const data = await prisma.janjez_services.findFirst({
    where: { id },
  });

  if (!data) return null;
  return data as unknown as JanzejService;
}

export async function createJanzejService(input: {
  name: string;
  slug: string;
  category: string;
  subcategory?: string;
  description?: string;
  selling_price_ksh: number;
  provider_service_id?: string | null;
  min_quantity: number;
  max_quantity: number;
  is_active?: boolean;
  display_order?: number;
  supports_drip_feed?: boolean;
  supports_refill?: boolean;
  supports_cancel?: boolean;
  show_sidebar?: boolean;
  show_landing?: boolean;
  show_guarded?: boolean;
  show_anonymous?: boolean;
  show_catalogue?: boolean;
}): Promise<JanzejService | { error: string }> {
  const supabase = createAdminClient();
  if (!supabase) return { error: "Server misconfigured" };

  const data = await prisma.janjez_services.create({
    data: {
      name: input.name,
      slug: input.slug,
      category: input.category,
      subcategory: input.subcategory || null,
      description: input.description || null,
      selling_price_ksh: input.selling_price_ksh,
      provider_service_id: input.provider_service_id || null,
      min_quantity: input.min_quantity,
      max_quantity: input.max_quantity,
      is_active: input.is_active ?? true,
      display_order: input.display_order ?? 0,
      supports_drip_feed: input.supports_drip_feed ?? false,
      supports_refill: input.supports_refill ?? false,
      supports_cancel: input.supports_cancel ?? false,
      show_sidebar: input.show_sidebar ?? false,
      show_landing: input.show_landing ?? false,
      show_guarded: input.show_guarded ?? true,
      show_anonymous: input.show_anonymous ?? true,
      show_catalogue: input.show_catalogue ?? true,
    },
  });

  return data as unknown as JanzejService;
}

export async function updateJanzejService(id: string, input: Partial<{
  name: string;
  slug: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  selling_price_ksh: number;
  provider_service_id: string | null;
  min_quantity: number;
  max_quantity: number;
  is_active: boolean;
  display_order: number;
  supports_drip_feed: boolean;
  supports_refill: boolean;
  supports_cancel: boolean;
  show_sidebar: boolean;
  show_landing: boolean;
  show_guarded: boolean;
  show_anonymous: boolean;
  show_catalogue: boolean;
}>): Promise<JanzejService | { error: string }> {
  const supabase = createAdminClient();
  if (!supabase) return { error: "Server misconfigured" };

  const data = await prisma.janjez_services.update({
    where: { id },
    data: input as any,
  });

  return data as unknown as JanzejService;
}

export async function deleteJanzejService(id: string): Promise<void | { error: string }> {
  const supabase = createAdminClient();
  if (!supabase) return { error: "Server misconfigured" };

  await prisma.janjez_services.update({
    where: { id },
    data: { is_active: false },
  });
}

export function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "service";
}

export async function getProviderCatalogFresh(): Promise<ProviderServiceRow[]> {
  const services = await fetchProviderServices();
  return services.map((s) => ({
    id: String(s.service),
    name: s.name,
    type: s.type,
    category: s.category,
    rate: parseFloat(s.rate),
    min: parseInt(s.min, 10),
    max: parseInt(s.max, 10),
    refill: s.refill,
    cancel: s.cancel,
    supports_drip_feed: s.dripfeed === true,
    is_active: true,
    fetched_at: new Date().toISOString(),
    raw: s,
  }));
}
