import crypto from 'crypto';
import { env } from '@/lib/config/env';
import { mpesaConfig } from './config';

interface MpesaResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  CheckoutRequestID?: string;
}

function generateTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/\s+/g, '');
  let p = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  if (p.startsWith('0')) p = `254${p.slice(1)}`;
  if (!p.startsWith('254')) p = `254${p}`;
  return p;
}

function buildPassword(): string {
  const timestamp = generateTimestamp();
  const raw = `${mpesaConfig.shortcode}${mpesaConfig.passkey}${timestamp}`;
  return Buffer.from(raw).toString('base64');
}

function signRequest(body: unknown, secret: string): string {
  const payload = JSON.stringify(body);
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getAccessToken(): Promise<MpesaResponse<{ access_token: string; expires_in: number }>> {
  try {
    const auth = Buffer.from(`${mpesaConfig.consumerKey}:${mpesaConfig.consumerSecret}`).toString('base64');

    const res = await fetchWithTimeout(
      `${mpesaConfig.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      {
        method: 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );

    if (!res.ok) {
      return { success: false, error: `Token request failed: ${res.status}` };
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function callMpesa<T>(
  endpoint: string,
  body: Record<string, unknown>,
  useHmac = true
): Promise<MpesaResponse<T>> {
  try {
    const tokenResult = await getAccessToken();
    if (!tokenResult.success || !tokenResult.data) {
      return { success: false, error: tokenResult.error || 'Failed to get access token' };
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${tokenResult.data.access_token}`,
      'Content-Type': 'application/json',
    };

    if (useHmac) {
      const signature = signRequest(body, mpesaConfig.consumerSecret);
      headers['X-Signature'] = signature;
    }

    const res = await fetchWithTimeout(`${mpesaConfig.baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return { success: false, error: `API request failed: ${res.status}` };
    }

    const data = (await res.json()) as T;
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function initiateStkPush(
  phone: string,
  amount: number,
  idempotencyKey: string
): Promise<MpesaResponse<{ CheckoutRequestID: string }>> {
  const timestamp = generateTimestamp();
  const password = buildPassword();
  const normalizedPhone = normalizePhone(phone);
  const callbackUrl = `${env.NEXT_PUBLIC_SITE_URL}/api/partner/activate/callback`;

  const result = await callMpesa<{ CheckoutRequestID: string }>(
    '/mpesa/stkpush/v1/processrequest',
    {
      BusinessShortCode: mpesaConfig.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: normalizedPhone,
      PartyB: mpesaConfig.shortcode,
      PhoneNumber: normalizedPhone,
      CallBackURL: callbackUrl,
      QueueTimeOutURL: callbackUrl,
      InvoiceNo: idempotencyKey,
      OrgAccountReference: idempotencyKey,
      TransactionDesc: 'Account activation',
    },
    true
  );

  return result;
}

export async function queryStkStatus(
  checkoutRequestID: string
): Promise<MpesaResponse<{ CheckoutRequestID: string; ResultCode: number; ResultDesc: string }>> {
  const timestamp = generateTimestamp();
  const password = buildPassword();

  const result = await callMpesa<{ CheckoutRequestID: string; ResultCode: number; ResultDesc: string }>(
    '/mpesa/stkpush/v1/query',
    {
      BusinessShortCode: mpesaConfig.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestID,
    },
    true
  );

  return result;
}
