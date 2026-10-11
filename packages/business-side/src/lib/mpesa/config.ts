import { env } from '@/lib/config/env';

const MPESA_BASE_URL =
  env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

export const mpesaConfig = {
  consumerKey: env.MPESA_CONSUMER_KEY ?? '',
  consumerSecret: env.MPESA_CONSUMER_SECRET ?? '',
  passkey: env.MPESA_PASSKEY ?? '',
  shortcode: env.MPESA_SHORTCODE ?? '',
  baseUrl: MPESA_BASE_URL,
} as const;
