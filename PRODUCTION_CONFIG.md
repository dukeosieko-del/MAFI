# janjez.social — Production Rollout Configuration

## 1. Environment Variables (Vercel Project: janjez-socio)

All of the following must be set in Vercel Dashboard → Project → Settings → Environment Variables (Production):

### Supabase / Auth
| Variable | Example Value | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://rousjavuooduvicaobuv.supabase.co` | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Yes |
| `NEXT_PUBLIC_SITE_URL` | `https://janjez.social` | Yes |

### Brevo SMTP (Transactional Emails)
| Variable | Example Value | Required |
|---|---|---|
| `BREVO_SMTP_HOST` | `smtp-relay.brevo.com` | Yes |
| `BREVO_SMTP_PORT` | `587` | Yes |
| `BREVO_SMTP_USER` | `osiekoduke@gmail.com` | Yes |
| `BREVO_SMTP_KEY` | `xkeysib-...` | Yes |
| `BREVO_FROM_EMAIL` | `noreply@janjez.social` | Yes |
| `BREVO_FROM_NAME` | `janjez.social` | Yes |

Brevo templates used: `user.verify_email`, `user.password_reset`, `user.welcome`, `order.received`, `order.completed`, `order.failed`, `payment.received`, `wallet.low_balance`, `admin.new_order`, `admin.high_value_order`, `admin.fulfillment_failure`, `system.maintenance`.

### M-Pesa (Safaricom Daraja)
| Variable | Example Value | Required |
|---|---|---|
| `MPESA_ENV` | `production` | Yes |
| `MPESA_CONSUMER_KEY` | `...` | Yes |
| `MPESA_CONSUMER_SECRET` | `...` | Yes |
| `MPESA_PASSKEY` | `...` | Yes |
| `MPESA_SHORTCODE` | `...` | Yes |
| `MPESA_CALLBACK_URL` | `https://www.janjez.social/api/mpesa/callback` | Yes |

M-Pesa STK Push uses `PartyA: <customer-phone>`, `PartyB: <shortcode>`, `PhoneNumber: <customer-phone>`, `TransactionType: CustomerBuyGoodsOnline`. Sandbox → `https://sandbox.safaricom.co.ke`, Production → `https://api.safaricom.co.ke`.

### SMM Fulfillment Provider
| Variable | Example Value | Required |
|---|---|---|
| `SMM_API_URL` | `https://provider-api.example.com` | Yes |
| `SMM_API_KEY` | `...` | Yes |
| `SMM_FULFILLMENT_ENABLED` | `true` | Yes |

### Cron / Security
| Variable | Example Value | Required |
|---|---|---|
| `CRON_SECRET` | `...` | Yes |
| `DEPLOY_URL` | `https://www.janjez.social` | Yes |

### Business Side Integration
| Variable | Example Value | Required |
|---|---|---|
| `BUSINESS_SIDE_API_KEY` | `...` | No |
| `BUSINESS_SIDE_HMAC_SECRET` | `...` | No |
| `BUSINESS_SIDE_ACCOUNT_ID` | `...` | No |

---

## 2. Google OAuth Configuration

In Supabase Dashboard → Authentication → URL Configuration:
- **Redirect URLs**: Add `https://www.janjez.social/auth/callback`

In Supabase Dashboard → Authentication → Providers → Google:
- Enable Google provider
- Enter Client ID and Client Secret from Google Cloud Console
- Authorized redirect URI: `https://www.janjez.social/auth/callback`

Google OAuth sign-up: Users signing up via Google get auto-created profiles with their Google email and metadata. Local email/password sign-up requires email verification before access.

---

## 3. Database Schema (Prisma)

25 tables migrated via `prisma db push`:
`profiles`, `orders`, `wallet_transactions`, `notifications`, `janjez_services`, `provider_services`, `service_mappings`, `fulfillment_logs`, `email_verifications`, `password_reset_tokens`, `security_events`, `admin_activity_logs`, `drip_feed_settings`, `platform_settings`, `blog_categories`, `blog_posts`, `blog_tags`, `blog_post_tags`, `blog_ratings`, `blog_comments`, `blog_post_views`, `contact_messages`, `affiliate_referrals`, `affiliate_earnings`, `affiliate_withdrawals`.

Provider is Prisma (PostgreSQL connector). Supabase project `rousjavuooduvicaobuv` has been removed from the codebase; the schema lives in `prisma/schema.prisma`.

---

## 4. Security Headers

Configured in `vercel.json` and `next.config.ts`:
- `X-Frame-Options: DENY` / `SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`
- `Content-Security-Policy` (restrictive)
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `X-XSS-Protection: 1; mode=block`

---

## 5. Rate Limiting

In-memory rate limiter per IP address:
- Sign-up: 10 req/min
- Resend verification: 5 req/min
- Password reset: 5 req/min
- M-Pesa STK push: 20 req/min
- M-Pesa check-status: 30 req/min
- M-Pesa callback: 30 req/min
- Reconciliation: 20 req/min
- Email verification: 60 req/min
- Admin: 60 req/min
- Cron: 60 req/min

---

## 6. Domain

`janjez.social` and `www.janjez.social` are connected to Vercel. The `www.janjez.social` domain serves the `mafi-deploy` Vercel project (alias configured in Vercel dashboard).

---

## 7. M-Pesa Drip Feed Sync

Drip feed orders pass `runs` and `interval` parameters to the SMM provider. Services with `supports_drip_feed = true` in `janjez_services` table are eligible. Provider catalog sync (`syncProviderCatalog`) fetches `dripfeed` flag from provider and stores it in `provider_services.supports_drip_feed`.

Reconciliation endpoint (`/api/mpesa/reconcile`) queries Safaricom STK status for pending transactions older than 60 seconds and settles them via `completeSttPayment`.

---

## 8. Files Modified in This Rollout

| File | Change |
|---|---|
| `prisma/schema.prisma` | Full Prisma schema (25 tables) — new |
| `src/lib/mpesa/client.ts` | Fixed PartyA/PartyB: PartyA=phone, PartyB=shortCode |
| `src/components/AuthContext.tsx` | loadProfile uses real auth user data |
| `supabase/` | Removed (migrated to Prisma) |
| `.supabase/` | Removed |
| `.gitignore` | Added `.env`, `.env.local`, `.env.*.local` |

---

## 9. Repository

All code is on GitHub: `https://github.com/dukeosieko-del/MAFI`
Branch: `database-backup` (contains Prisma schema, M-Pesa fix, all auth flows, Brevo config, M-Pesa drip feed, reconciliation, security headers)

Production URL: `https://www.janjez.social`