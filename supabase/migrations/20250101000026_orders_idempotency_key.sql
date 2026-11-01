-- Add idempotency_key column to orders table for duplicate-submission protection
-- Run this migration in your Supabase dashboard: SQL Editor

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_user_idempotency_key
  ON public.orders(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
