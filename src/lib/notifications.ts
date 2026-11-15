import { createAdminClient, prisma } from "@/lib/supabase/admin";

export type NotificationAudience = "user" | "admin";
export type NotificationSeverity = "info" | "success" | "warning" | "error" | "critical";
export type NotificationCategory =
  | "order"
  | "wallet"
  | "security"
  | "system"
  | "admin_alert"
  | "fulfillment_failure";

export interface Notification {
  id: string;
  user_id: string;
  audience: NotificationAudience;
  category: NotificationCategory;
  title: string;
  body: string | null;
  link: string | null;
  severity: NotificationSeverity;
  read_at: string | null;
  created_at: string;
}

export interface CreateNotificationInput {
  userId: string;
  audience?: NotificationAudience;
  category?: NotificationCategory;
  title: string;
  body?: string | null;
  link?: string | null;
  severity?: NotificationSeverity;
}

export interface NotificationPayload {
  title: string;
  body?: string;
  link?: string | null;
  severity?: NotificationSeverity;
}

export async function createNotification(
  input: CreateNotificationInput
): Promise<Notification | null> {
  const supabase = createAdminClient();
  if (!supabase) return null;

  try {
    const row = await prisma.notifications.create({
      data: {
        user_id: input.userId,
        audience: input.audience ?? "user",
        category: input.category ?? "system",
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        severity: input.severity ?? "info",
      },
    });

    return {
      id: row.id,
      user_id: row.user_id,
      audience: row.audience as NotificationAudience,
      category: row.category as NotificationCategory,
      title: row.title,
      body: row.body,
      link: row.link,
      severity: row.severity as NotificationSeverity,
      read_at: row.read_at?.toISOString() || null,
      created_at: row.created_at.toISOString(),
    };
  } catch (err) {
    console.error("createNotification error:", err);
    return null;
  }
}

export async function notifyUser(
  userId: string,
  category: NotificationCategory,
  payload: NotificationPayload
): Promise<Notification | null> {
  return createNotification({
    userId,
    audience: "user",
    category,
    title: payload.title,
    body: payload.body ?? null,
    link: payload.link ?? null,
    severity: payload.severity ?? "info",
  });
}

export async function notifyAdmins(
  category: NotificationCategory,
  payload: NotificationPayload
): Promise<Notification[]> {
  const supabase = createAdminClient();
  if (!supabase) return [];

  try {
    const admins = await prisma.profiles.findMany({
      where: { role: "admin" },
      select: { id: true },
    });

    if (!admins || admins.length === 0) return [];

    const rows = admins.map((a) => ({
      user_id: a.id,
      audience: "admin" as NotificationAudience,
      category,
      title: payload.title,
      body: payload.body ?? null,
      link: payload.link ?? null,
      severity: payload.severity ?? "info",
    }));

    const created = await prisma.notifications.createMany({
      data: rows,
    });

    return created ? rows.map((r, i) => ({
      ...r,
      read_at: null,
      created_at: new Date().toISOString(),
    })) : [];
  } catch (err) {
    console.error("notifyAdmins insert error:", err);
    return [];
  }
}

export async function markRead(
  notificationId: string,
  userId: string
): Promise<boolean> {
  const supabase = createAdminClient();
  if (!supabase) return false;

  try {
    const notification = await prisma.notifications.findFirst({
      where: { id: notificationId },
    });

    if (!notification || notification.user_id !== userId) {
      console.error("markRead ownership mismatch");
      return false;
    }

    await prisma.notifications.update({
      where: { id: notificationId },
      data: { read_at: new Date() },
    });

    return true;
  } catch (err) {
    console.error("markRead error:", err);
    return false;
  }
}

export async function markAllRead(userId: string): Promise<number> {
  const supabase = createAdminClient();
  if (!supabase) return 0;

  try {
    const result = await prisma.notifications.updateMany({
      where: { user_id: userId, read_at: null },
      data: { read_at: new Date() },
    });

    return result.count;
  } catch (err) {
    console.error("markAllRead error:", err);
    return 0;
  }
}

export interface ListNotificationsOptions {
  audience?: NotificationAudience;
  limit?: number;
  cursor?: string | null;
  unreadOnly?: boolean;
}

export interface ListNotificationsResult {
  notifications: Notification[];
  nextCursor: string | null;
}

export async function listNotifications(
  userId: string,
  options: ListNotificationsOptions = {}
): Promise<ListNotificationsResult> {
  const supabase = createAdminClient();
  if (!supabase) return { notifications: [], nextCursor: null };

  try {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const audience = options.audience ?? "user";

    const where: any = audience === "admin"
      ? { audience: "admin" }
      : { audience: "user", user_id: userId };

    if (options.unreadOnly) {
      where.read_at = null;
    }

    const [notifications, hasMore] = await Promise.all([
      prisma.notifications.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: limit + 1,
        options.cursor ? { cursor: { created_at: options.cursor } } : {},
      } as any),
      prisma.notifications.count({ where }),
    ]);

    const rows = notifications.slice(0, limit);
    const nextCursor = rows.length > limit ? rows[rows.length - 1].created_at.toISOString() : null;

    return {
      notifications: rows.map((n) => ({
        id: n.id,
        user_id: n.user_id,
        audience: n.audience as NotificationAudience,
        category: n.category as NotificationCategory,
        title: n.title,
        body: n.body,
        link: n.link,
        severity: n.severity as NotificationSeverity,
        read_at: n.read_at?.toISOString() || null,
        created_at: n.created_at.toISOString(),
      })),
      nextCursor,
    };
  } catch (err) {
    console.error("listNotifications error:", err);
    return { notifications: [], nextCursor: null };
  }
}

export async function deleteNotification(
  notificationId: string,
  userId: string
): Promise<boolean> {
  const supabase = createAdminClient();
  if (!supabase) return false;

  try {
    const notification = await prisma.notifications.findFirst({
      where: { id: notificationId },
    });

    if (!notification || notification.user_id !== userId) {
      console.error("deleteNotification ownership mismatch");
      return false;
    }

    await prisma.notifications.delete({
      where: { id: notificationId },
    });

    return true;
  } catch (err) {
    console.error("deleteNotification error:", err);
    return false;
  }
}
