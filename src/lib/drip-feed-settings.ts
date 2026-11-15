import { createAdminClient, prisma } from "@/lib/supabase/admin";

export interface DripFeedLimits {
  enabled: boolean;
  min_runs: number;
  max_runs: number;
  min_interval: number;
  max_interval: number;
}

export async function getDripFeedLimits(): Promise<DripFeedLimits> {
  const supabase = createAdminClient();
  if (!supabase) {
    return { enabled: true, min_runs: 1, max_runs: 20, min_interval: 10, max_interval: 1440 };
  }

  const setting = await prisma.platform_settings.findFirst({
    where: { key: "drip_feed_limits" },
    select: { value: true },
  });

  if (!setting) {
    return { enabled: true, min_runs: 1, max_runs: 20, min_interval: 10, max_interval: 1440 };
  }

  const value = setting.value as Record<string, unknown>;
  return {
    enabled: value.enabled !== false,
    min_runs: Number(value.min_runs) || 1,
    max_runs: Number(value.max_runs) || 20,
    min_interval: Number(value.min_interval) || 10,
    max_interval: Number(value.max_interval) || 1440,
  };
}

export function getDripFeedLimitsSync(): DripFeedLimits {
  return { enabled: true, min_runs: 1, max_runs: 20, min_interval: 10, max_interval: 1440 };
}
