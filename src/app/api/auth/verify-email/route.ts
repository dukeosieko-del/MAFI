import { NextResponse, NextRequest } from "next/server";
import { createAdminClient, prisma } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/email/config";
import { rateLimit } from "@/lib/server/rate-limiter";
import { sendTransactional } from "@/lib/transactional";

export const runtime = "nodejs";

const REDIRECT_BASE = SITE_URL;

export async function GET(request: NextRequest) {
  try {
    const rl = rateLimit(request, 60);
    if (!rl.ok && rl.response) return rl.response;

    const requestUrl = new URL(request.url);
    const token = requestUrl.searchParams.get("token");

    if (!token) {
      return NextResponse.redirect(new URL("/auth/sign-in?error=missing_token", REDIRECT_BASE));
    }

    const supabase = createAdminClient();
    if (!supabase) {
      return NextResponse.redirect(new URL("/auth/sign-in?error=server_misconfigured", REDIRECT_BASE));
    }

    const verification = await prisma.emailVerification.findFirst({
      where: { token },
    });

    if (!verification) {
      return NextResponse.redirect(new URL("/auth/sign-in?error=invalid_token", REDIRECT_BASE));
    }

    if (new Date(verification.expiresAt) < new Date()) {
      await prisma.emailVerification.delete({ where: { id: verification.id } });
      return NextResponse.redirect(new URL("/auth/sign-in?error=token_expired", REDIRECT_BASE));
    }

    const profile = await prisma.profile.findFirst({
      where: { id: verification.userId },
      select: { id: true, email: true, emailVerified: true },
    });

    if (!profile) {
      return NextResponse.redirect(new URL("/auth/sign-in?error=profile_not_found", REDIRECT_BASE));
    }

    if (profile.emailVerified) {
      await prisma.emailVerification.delete({ where: { id: verification.id } });
    return NextResponse.redirect(new URL(`/auth/sign-in?verified=1&email=${encodeURIComponent(profile.email || "")}`, REDIRECT_BASE));
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(verification.userId, {
      email_confirm: true,
    });

    if (updateError) {
      console.error("Failed to confirm email:", updateError);
      return NextResponse.redirect(new URL("/auth/sign-in?error=verification_failed", REDIRECT_BASE));
    }

    const { data: authUser } = await supabase.auth.admin.getUserById(verification.userId);
    const fullName = (authUser?.user?.user_metadata?.fullName as string | undefined) || null;
    const welcomeResult = await sendTransactional({
      name: "user.welcome",
      userId: verification.userId,
      email: profile.email || "",
      fullName,
      data: {
        fullName,
        signInUrl: `${SITE_URL}/auth/sign-in`,
      },
    });
    if (!welcomeResult.emailOk) {
      console.error("Welcome email send failed");
    }

    await prisma.emailVerification.delete({ where: { id: verification.id } });

    return NextResponse.redirect(new URL(`/auth/sign-in?verified=1&email=${encodeURIComponent(profile.email || "")}`, REDIRECT_BASE));
  } catch {
    return NextResponse.redirect(new URL("/auth/sign-in?error=unexpected", REDIRECT_BASE));
  }
}
