import { NextResponse, NextRequest } from "next/server";
import { createAdminClient, prisma } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/email/config";
import { rateLimit } from "@/lib/server/rate-limiter";
import { sanitizeString } from "@/lib/server/validation";
import { sendTransactional } from "@/lib/transactional";
import crypto from "crypto";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_]{3,30}$/;
const RESEND_RATE_LIMIT = 5;
const SIGNUP_RATE_LIMIT = 10;

export const runtime = "nodejs";

async function sendVerificationEmail(
  userId: string,
  email: string,
  fullName: string | null
): Promise<{ ok: boolean; error?: string }> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  try {
    await prisma.email_verifications.deleteMany({ where: { user_id: userId } });
  } catch (err) {
    console.error("Failed to invalidate previous verification tokens:", err);
  }

  try {
    await prisma.email_verifications.create({
      data: {
        user_id: userId,
        token,
        expires_at: expiresAt,
      },
    });
  } catch {
    return { ok: false, error: "Failed to create verification record" };
  }

  const verifyUrl = `${SITE_URL}/api/auth/verify-email?token=${token}`;
  const { emailOk } = await sendTransactional({
    name: "user.verify_email",
    userId,
    email,
    fullName,
    data: { fullName, verifyUrl, expiresInHours: 24 },
  });

  if (!emailOk) {
    return { ok: false, error: "Failed to send verification email" };
  }
  return { ok: true };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, full_name, phone, username, resend } = body as {
      email: string;
      password?: string;
      full_name?: string;
      phone?: string;
      username?: string;
      resend?: boolean;
    };

    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
    }

    const sanitizedEmail = sanitizeString(email, 254) || email;
    const sanitizedFullName = sanitizeString(full_name, 100);
    const sanitizedPhone = sanitizeString(phone, 30);
    const sanitizedUsername = username !== undefined ? sanitizeString(username, 30) : null;

    if (sanitizedUsername !== null && !USERNAME_RE.test(sanitizedUsername)) {
      return NextResponse.json({ error: "Username must be 3-30 characters, lowercase letters, numbers, and underscores only" }, { status: 400 });
    }

    const supabase = createAdminClient();
    if (!supabase) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const { data: existing } = await supabase.auth.admin.listUsers();
    const user = existing?.users?.find((u: { email?: string }) => u.email === sanitizedEmail);

    if (resend) {
      const rl = rateLimit(request, RESEND_RATE_LIMIT);
      if (!rl.ok && rl.response) return rl.response;

      if (!user) {
        return NextResponse.json({ ok: true, message: "If an account exists for this email, a verification link has been sent." });
      }

      if (user.email_confirmed_at) {
        return NextResponse.json({ error: "Email is already verified. You can sign in." }, { status: 400 });
      }

      const emailResult = await sendVerificationEmail(user.id, sanitizedEmail, user.user_metadata?.full_name || null);
      if (!emailResult.ok) {
        return NextResponse.json({ error: "Failed to send verification email. Please try again later." }, { status: 500 });
      }

      return NextResponse.json({ ok: true, message: "Verification email sent. Check your inbox." });
    }

    if (!password) {
      return NextResponse.json({ error: "Password is required for signup" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const rl = rateLimit(request, SIGNUP_RATE_LIMIT);
    if (!rl.ok && rl.response) return rl.response;

    if (user) {
      if (user.email_confirmed_at) {
        return NextResponse.json({ error: "Email is already registered and verified." }, { status: 409 });
      }

      const emailResult = await sendVerificationEmail(user.id, sanitizedEmail, user.user_metadata?.full_name || null);
      if (!emailResult.ok) {
        return NextResponse.json({ error: "Failed to send verification email. Please try again later." }, { status: 500 });
      }

      return NextResponse.json({ ok: true, message: "Account already exists but is not verified. A new verification email has been sent." });
    }

    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: sanitizedEmail,
      password,
      email_confirm: false,
      user_metadata: {
        full_name: sanitizedFullName || null,
        phone: sanitizedPhone || null,
        username: sanitizedUsername || null,
      },
    });

    if (createError || !newUser.user) {
      return NextResponse.json({ error: createError?.message || "Failed to create user" }, { status: 400 });
    }

    if (sanitizedUsername) {
      const profileUpdateError = await prisma.profiles.update({
        where: { id: newUser.user.id },
        data: { username: sanitizedUsername },
      }).then(() => null).catch((err: any) => err);
      if (profileUpdateError) {
        await supabase.auth.admin.deleteUser(newUser.user.id);
        return NextResponse.json({ error: "Failed to set username. Please try again." }, { status: 500 });
      }
    }

    const emailResult = await sendVerificationEmail(newUser.user.id, sanitizedEmail, sanitizedFullName || null);
    if (!emailResult.ok) {
      await supabase.auth.admin.deleteUser(newUser.user.id);
      return NextResponse.json({ error: "Failed to send verification email. Please try again later." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: "Account created. Check your email to verify.",
    });
  } catch (error) {
    console.error("Signup API error:", error);
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
