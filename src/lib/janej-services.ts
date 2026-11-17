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
  sellingPriceKsh: number;
  providerServiceId: string | null;
  minQuantity: number;
  maxQuantity: number;
  is_active: boolean;
  displayOrder: number;
  supportsDripFeed: boolean;
  supportsRefill: boolean;
  supportsCancel: boolean;
  showSidebar: boolean;
  showLanding: boolean;
  showGuarded: boolean;
  showAnonymous: boolean;
  showCatalogue: boolean;
  createdAt: string;
  updatedAt: string;
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
  supportsDripFeed: boolean;
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
    where.supportsDripFeed = true;
  }

  const data = await prisma.providerService.findMany({
    where,
    orderBy: { rate: "asc" },
  });

  return (data || []) as unknown as ProviderServiceRow[];
}

export async function listJanjezServices(activeOnly: boolean = false, placement?: keyof Pick<JanzejService, "showSidebar" | "showLanding" | "showGuarded" | "showAnonymous" | "showCatalogue">): Promise<JanzejService[]> {
  const supabase = createAdminClient();
  if (!supabase) return [];

  let where: any = {};

  if (activeOnly) {
    where.isActive = true;
  }

  if (placement) {
    where[placement] = true;
  }

  const cacheKey = `${activeOnly}:${placement ?? ""}`;
  const cached = SERVICES_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SERVICES_CACHE_TTL_MS) {
    return cached.services;
  }

  const all = await prisma.janjezService.findMany({
    where,
    orderBy: [
      { displayOrder: "asc" },
      { createdAt: "desc" },
    ],
  });

  SERVICES_CACHE.set(cacheKey, { services: all as unknown as JanzejService[], timestamp: Date.now() });
  return all as unknown as JanzejService[];
}

export async function getJanjezService(id: string): Promise<JanzejService | null> {
  const supabase = createAdminClient();
  if (!supabase) return null;

  const data = await prisma.janjezService.findFirst({
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
  sellingPriceKsh: number;
  providerServiceId?: string | null;
  minQuantity: number;
  maxQuantity: number;
  is_active?: boolean;
  displayOrder?: number;
  supportsDripFeed?: boolean;
  supportsRefill?: boolean;
  supportsCancel?: boolean;
  showSidebar?: boolean;
  showLanding?: boolean;
  showGuarded?: boolean;
  showAnonymous?: boolean;
  showCatalogue?: boolean;
}): Promise<JanzejService | { error: string }> {
  const supabase = createAdminClient();
  if (!supabase) return { error: "Server misconfigured" };

  const data = await prisma.janjezService.create({
    data: {
      name: input.name,
      slug: input.slug,
      category: input.category,
      subcategory: input.subcategory || null,
      description: input.description || null,
      sellingPriceKsh: input.sellingPriceKsh,
      providerServiceId: input.providerServiceId || null,
      minQuantity: input.minQuantity,
      maxQuantity: input.maxQuantity,
      isActive: input.is_active ?? true,
      displayOrder: input.displayOrder ?? 0,
      supportsDripFeed: input.supportsDripFeed ?? false,
      supportsRefill: input.supportsRefill ?? false,
      supportsCancel: input.supportsCancel ?? false,
      showSidebar: input.showSidebar ?? false,
      showLanding: input.showLanding ?? false,
      showGuarded: input.showGuarded ?? true,
      showAnonymous: input.showAnonymous ?? true,
      showCatalogue: input.showCatalogue ?? true,
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
  sellingPriceKsh: number;
  providerServiceId: string | null;
  minQuantity: number;
  maxQuantity: number;
  is_active: boolean;
  displayOrder: number;
  supportsDripFeed: boolean;
  supportsRefill: boolean;
  supportsCancel: boolean;
  showSidebar: boolean;
  showLanding: boolean;
  showGuarded: boolean;
  showAnonymous: boolean;
  showCatalogue: boolean;
}>): Promise<JanzejService | { error: string }> {
  const supabase = createAdminClient();
  if (!supabase) return { error: "Server misconfigured" };

  const data = await prisma.janjezService.update({
    where: { id },
    data: input as any,
  });

  return data as unknown as JanzejService;
}

export async function deleteJanzejService(id: string): Promise<void | { error: string }> {
  const supabase = createAdminClient();
  if (!supabase) return { error: "Server misconfigured" };

  await prisma.janjezService.update({
    where: { id },
    data: { isActive: false },
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
    supportsDripFeed: s.dripfeed === true,
    is_active: true,
    fetched_at: new Date().toISOString(),
    raw: s,
  }));
}
