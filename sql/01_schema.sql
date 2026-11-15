-- 01_schema.sql - combined from repo migrations (idempotent)

-- ===== 20250101000000_create_profiles_table.sql =====
-- Create profiles table for additional user data
-- Run this migration in your Supabase dashboard: SQL Editor

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  phone TEXT,
  wallet_balance DECIMAL(10, 2) DEFAULT 0.00 NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create policy for users to view their own profile
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

-- Create policy for users to update their own profile
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Create policy for users to insert their own profile
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Create trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger the function on signup
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Seed existing users with wallet balance
UPDATE public.profiles
SET wallet_balance = 1000.00
WHERE wallet_balance = 0.00;


-- ===== 20250101000001_email_verification.sql =====
-- Email verification tables for custom branded verification emails
-- Run this migration in your Supabase dashboard: SQL Editor

-- Add email_verified to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE NOT NULL;

-- Create email_verifications table
CREATE TABLE IF NOT EXISTS public.email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own verification records" ON public.email_verifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own verification records" ON public.email_verifications
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Auto-set email_verified true when auth.users.email_confirmed_at is set
CREATE OR REPLACE FUNCTION public.sync_email_verified()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
    UPDATE public.profiles
    SET email_verified = TRUE
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_email_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_email_verified();


-- ===== 20250101000002_admin_tables.sql =====
-- Admin role and activity logging tables
-- Run this migration in your Supabase dashboard: SQL Editor

-- Add role to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user' NOT NULL;

-- Create admin_activity_logs table
CREATE TABLE IF NOT EXISTS public.admin_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all activity logs" ON public.admin_activity_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can insert activity logs" ON public.admin_activity_logs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_actor_id ON public.admin_activity_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_created_at ON public.admin_activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_action ON public.admin_activity_logs(action);

-- Seed first admin (replace email with actual admin email)
-- UPDATE public.profiles SET role = 'admin' WHERE email = 'admin@janjez.social';


-- ===== 20250101000003_orders_table.sql =====
-- Orders table for tracking client orders
-- Run this migration in your Supabase dashboard: SQL Editor

CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  service_name TEXT NOT NULL,
  service_id TEXT,
  link TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  amount DECIMAL(10, 2) NOT NULL CHECK (amount >= 0),
  comments TEXT,
  status TEXT DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'cancelled', 'failed')),
  payment_status TEXT DEFAULT 'unpaid' NOT NULL CHECK (payment_status IN ('unpaid', 'paid', 'refunded')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own orders" ON public.orders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own orders" ON public.orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own orders" ON public.orders
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all orders" ON public.orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can update all orders" ON public.orders
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- Triggers
CREATE OR REPLACE FUNCTION public.update_order_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_order_updated
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_order_timestamp();

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders(payment_status);


-- ===== 20250101000004_wallet_transactions.sql =====
-- Wallet transactions for ledger and financial tracking
-- Run this migration in your Supabase dashboard: SQL Editor

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('topup', 'spend', 'refund', 'bonus', 'adjustment')),
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'KES' NOT NULL,
  reference TEXT,
  status TEXT DEFAULT 'completed' NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
  payment_method TEXT CHECK (payment_method IN ('mpesa', 'card', 'bank', 'other')),
  mpesa_receipt TEXT,
  mpesa_phone TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions" ON public.wallet_transactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions" ON public.wallet_transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all transactions" ON public.wallet_transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can insert transactions" ON public.wallet_transactions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE OR REPLACE FUNCTION public.update_transaction_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_transaction_updated
  BEFORE UPDATE ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_transaction_timestamp();

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON public.wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_type ON public.wallet_transactions(type);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_status ON public.wallet_transactions(status);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON public.wallet_transactions(created_at DESC);


-- ===== 20250101000005_orders_extended.sql =====
-- Extend orders table for order confirmation and logging
-- Run this migration in your Supabase dashboard: SQL Editor

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS subcategory TEXT,
  ADD COLUMN IF NOT EXISTS sku_id TEXT,
  ADD COLUMN IF NOT EXISTS link_submitted TEXT,
  ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS refill_guarantee TEXT,
  ADD COLUMN IF NOT EXISTS quantity_source TEXT CHECK (quantity_source IN ('preset', 'custom'));

CREATE INDEX IF NOT EXISTS idx_orders_sku_id ON public.orders(sku_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment_reference ON public.orders(payment_reference);


-- ===== 20250101000006_notifications.sql =====
-- Notifications table for user-facing account activity feed
-- Run this migration in your Supabase dashboard: SQL Editor

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  read BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Service can insert notifications for users" ON public.notifications
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = notifications.user_id
    )
  );

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(read);


-- ===== 20250101000007_smm_provider_integration.sql =====
-- SMM Provider Integration tables
-- Run this migration in your Supabase dashboard: SQL Editor

-- Provider service catalog cache
CREATE TABLE IF NOT EXISTS public.provider_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  category TEXT,
  rate DECIMAL(10, 5) NOT NULL,
  min INTEGER NOT NULL,
  max INTEGER NOT NULL,
  refill BOOLEAN DEFAULT FALSE,
  cancel BOOLEAN DEFAULT FALSE,
  raw JSONB,
  fetched_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.provider_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage provider services" ON public.provider_services;
CREATE POLICY "Admins can manage provider services" ON public.provider_services
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_provider_services_category ON public.provider_services(category);
CREATE INDEX IF NOT EXISTS idx_provider_services_rate ON public.provider_services(rate);
CREATE INDEX IF NOT EXISTS idx_provider_services_fetched_at ON public.provider_services(fetched_at DESC);

-- Service mappings: janjez service -> provider service
CREATE TABLE IF NOT EXISTS public.service_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id TEXT NOT NULL,
  subcategory_name TEXT NOT NULL,
  deliverable_name TEXT NOT NULL,
  provider_service_id TEXT NOT NULL REFERENCES public.provider_services(id) ON DELETE CASCADE,
  match_reason TEXT DEFAULT 'cheapest' CHECK (match_reason IN ('cheapest', 'manual', 'alias')),
  is_active BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(platform_id, subcategory_name, deliverable_name)
);

ALTER TABLE public.service_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage service mappings" ON public.service_mappings;
CREATE POLICY "Admins can manage service mappings" ON public.service_mappings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_service_mappings_platform ON public.service_mappings(platform_id);
CREATE INDEX IF NOT EXISTS idx_service_mappings_provider_service ON public.service_mappings(provider_service_id);
CREATE INDEX IF NOT EXISTS idx_service_mappings_active ON public.service_mappings(is_active) WHERE is_active = TRUE;

-- Provider order references
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS provider_service_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_status TEXT,
  ADD COLUMN IF NOT EXISTS provider_start_count TEXT,
  ADD COLUMN IF NOT EXISTS provider_remains TEXT,
  ADD COLUMN IF NOT EXISTS provider_currency TEXT DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS provider_charge DECIMAL(10, 5),
  ADD COLUMN IF NOT EXISTS fulfillment_status TEXT DEFAULT 'pending' CHECK (fulfillment_status IN ('pending', 'processing', 'fulfilled', 'failed', 'cancelled', 'refunded')),
  ADD COLUMN IF NOT EXISTS fulfillment_error TEXT,
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status ON public.orders(fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_orders_provider_order_id ON public.orders(provider_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_provider_service_id ON public.orders(provider_service_id);

-- Fulfillment logs
CREATE TABLE IF NOT EXISTS public.fulfillment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  provider_order_id TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  request_payload JSONB,
  response_payload JSONB,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.fulfillment_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view fulfillment logs" ON public.fulfillment_logs;
CREATE POLICY "Admins can view fulfillment logs" ON public.fulfillment_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "System can insert fulfillment logs" ON public.fulfillment_logs;
CREATE POLICY "System can insert fulfillment logs" ON public.fulfillment_logs
  FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_fulfillment_logs_order_id ON public.fulfillment_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_fulfillment_logs_created_at ON public.fulfillment_logs(created_at DESC);

-- Trigger for updated_at
DROP FUNCTION IF EXISTS public.update_service_mapping_timestamp();
CREATE OR REPLACE FUNCTION public.update_service_mapping_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_service_mapping_updated ON public.service_mappings;
CREATE OR REPLACE TRIGGER on_service_mapping_updated
  BEFORE UPDATE ON public.service_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_service_mapping_timestamp();


-- ===== 20250101000008_orders_order_id.sql =====
-- Add human-readable order_id column for order references (ORD-XXXX format)
-- This column is populated by the orders API and displayed in the UI

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_order_id ON public.orders(order_id);


-- ===== 20250101000009_orders_order_id_backfill.sql =====
-- Backfill existing orders with human-readable order_id values
-- and add a trigger to auto-generate them for new orders

-- Backfill: set order_id for any rows that are missing one
UPDATE public.orders
SET order_id = 'ORD-' || substr(replace(id::text, '-', ''), 1, 8)
WHERE order_id IS NULL OR order_id = '';

-- Trigger to auto-generate order_id on insert if not provided
DROP FUNCTION IF EXISTS public.generate_order_id();
CREATE OR REPLACE FUNCTION public.generate_order_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.order_id IS NULL OR NEW.order_id = '' THEN
    NEW.order_id = 'ORD-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_order_insert ON public.orders;
CREATE TRIGGER on_order_insert
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.generate_order_id();


-- ===== 20250101000010_fulfillment_logs_provider_order_id_index.sql =====
-- Add index on fulfillment_logs.provider_order_id for provider order lookups
-- Run this migration in your Supabase dashboard: SQL Editor

CREATE INDEX IF NOT EXISTS idx_fulfillment_logs_provider_order_id ON public.fulfillment_logs(provider_order_id);


-- ===== 20250101000011_wallet_atomic_functions.sql =====
-- Atomic wallet balance functions to prevent race conditions and money minting
-- debit_wallet: atomically decreases balance only if sufficient funds exist
-- credit_wallet: atomically increases balance (for M-Pesa top-ups)

CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_user_id UUID,
  p_amount DECIMAL
)
RETURNS TABLE(new_balance DECIMAL)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT COALESCE(wallet_balance, 0) FROM profiles WHERE id = p_user_id;
    RETURN;
  END IF;

  UPDATE profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::DECIMAL;
  ELSE
    RETURN QUERY SELECT wallet_balance FROM profiles WHERE id = p_user_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.debit_wallet(
  p_user_id UUID,
  p_amount DECIMAL
)
RETURNS TABLE(new_balance DECIMAL, success BOOLEAN)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_amount < 0 THEN
    RETURN QUERY SELECT wallet_balance, FALSE FROM profiles WHERE id = p_user_id;
    RETURN;
  END IF;

  UPDATE profiles
  SET wallet_balance = wallet_balance - p_amount
  WHERE id = p_user_id AND wallet_balance >= p_amount;

  IF NOT FOUND THEN
    RETURN QUERY SELECT wallet_balance, FALSE FROM profiles WHERE id = p_user_id;
  ELSE
    RETURN QUERY SELECT wallet_balance, TRUE FROM profiles WHERE id = p_user_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.credit_wallet IS 'Atomically credits a user wallet. Use for M-Pesa top-ups.';
COMMENT ON FUNCTION public.debit_wallet IS 'Atomically debits a user wallet only if sufficient balance exists. Returns success flag.';


-- ===== 20250101000012_orders_catalog_category_id.sql =====
-- Add catalog_category_id column to orders table for server-side price verification
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS catalog_category_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_catalog_category_id ON public.orders(catalog_category_id);


-- ===== 20250101000013_profiles_extended.sql =====
-- Extend profiles table with UI and settings columns
-- Run this migration in your Supabase dashboard: SQL Editor

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS notification_email BOOLEAN DEFAULT TRUE NOT NULL,
  ADD COLUMN IF NOT EXISTS notification_sms BOOLEAN DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'dark' NOT NULL,
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en' NOT NULL;

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_profile_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_profile_updated ON public.profiles;
CREATE TRIGGER on_profile_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_profile_timestamp();


-- ===== 20250101000014_affiliate.sql =====
-- Affiliate system tables
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.affiliate_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  referee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  referee_email TEXT,
  code TEXT NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'active', 'converted')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.affiliate_referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own referrals" ON public.affiliate_referrals
  FOR SELECT USING (auth.uid() = referrer_id);

CREATE POLICY "Users can create referrals" ON public.affiliate_referrals
  FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_referrer ON public.affiliate_referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_code ON public.affiliate_referrals(code);

CREATE TABLE IF NOT EXISTS public.affiliate_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  amount DECIMAL(10, 2) NOT NULL CHECK (amount >= 0),
  status TEXT DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.affiliate_earnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own earnings" ON public.affiliate_earnings
  FOR SELECT USING (auth.uid() = referrer_id);

CREATE POLICY "Admins can manage earnings" ON public.affiliate_earnings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_referrer ON public.affiliate_earnings(referrer_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_status ON public.affiliate_earnings(status);

CREATE TABLE IF NOT EXISTS public.affiliate_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  amount DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
  mpesa_phone TEXT,
  status TEXT DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'paid', 'rejected')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.affiliate_withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own withdrawals" ON public.affiliate_withdrawals
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create withdrawals" ON public.affiliate_withdrawals
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can manage withdrawals" ON public.affiliate_withdrawals
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_affiliate_withdrawals_user ON public.affiliate_withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_withdrawals_status ON public.affiliate_withdrawals(status);


-- ===== 20250101000015_storage_avatars.sql =====
-- Storage setup for avatars bucket
-- Note: In Supabase, storage buckets may need to be created via Dashboard or CLI first.
-- This migration creates the bucket record and policies.

-- Create avatars bucket (public read, authenticated upload)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies
CREATE POLICY "Avatar files are publicly accessible" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "Authenticated users can upload avatars" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars' 
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can update own avatars" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars' 
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete own avatars" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars' 
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- ===== 20250101000022_service_placement.sql =====
-- Service placement controls for customer-facing surfaces
-- These flags control where active janjez_services are exposed without affecting fulfillment.

ALTER TABLE public.janjez_services
  ADD COLUMN IF NOT EXISTS show_sidebar BOOLEAN DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS show_landing BOOLEAN DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS show_guarded BOOLEAN DEFAULT TRUE NOT NULL,
  ADD COLUMN IF NOT EXISTS show_anonymous BOOLEAN DEFAULT TRUE NOT NULL,
  ADD COLUMN IF NOT EXISTS show_catalogue BOOLEAN DEFAULT TRUE NOT NULL;

CREATE INDEX IF NOT EXISTS idx_janjez_services_show_sidebar ON public.janjez_services(show_sidebar) WHERE show_sidebar = TRUE;
CREATE INDEX IF NOT EXISTS idx_janjez_services_show_landing ON public.janjez_services(show_landing) WHERE show_landing = TRUE;
CREATE INDEX IF NOT EXISTS idx_janjez_services_show_guarded ON public.janjez_services(show_guarded) WHERE show_guarded = TRUE;
CREATE INDEX IF NOT EXISTS idx_janjez_services_show_anonymous ON public.janjez_services(show_anonymous) WHERE show_anonymous = TRUE;
CREATE INDEX IF NOT EXISTS idx_janjez_services_show_catalogue ON public.janjez_services(show_catalogue) WHERE show_catalogue = TRUE;


-- ===== 20250101000023_pending_mpesa_payment_status.sql =====
-- Fix orders payment_status CHECK constraint to support pending_mpesa for anonymous orders

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_payment_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('unpaid', 'pending_mpesa', 'paid', 'refunded'));


-- ===== 20250101000024_password_reset_tokens.sql =====
-- Password reset tokens table for custom branded password reset flow
-- Run this migration in your Supabase dashboard: SQL Editor

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON public.password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON public.password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON public.password_reset_tokens(expires_at);

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view password reset tokens" ON public.password_reset_tokens
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can insert password reset tokens" ON public.password_reset_tokens
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can update password reset tokens" ON public.password_reset_tokens
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can delete password reset tokens" ON public.password_reset_tokens
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );


-- ===== 20250101000025_profiles_admin_policies.sql =====
-- Add admin SELECT-all policy to profiles
-- Allows admin-role users to read all profile rows via the anon/authenticated key
-- FIX: Use subquery against auth.users to avoid recursive RLS self-reference
-- (original policy queried profiles from within a policy ON profiles)

CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT USING (
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
  );

-- Add admin UPDATE-all policy on profiles for support tooling
CREATE POLICY "Admins can update all profiles" ON public.profiles
  FOR UPDATE USING (
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
  );


-- ===== 20250101000026_add_username_to_profiles.sql =====
-- Add username column to profiles table
-- Case-insensitive unique index, length/format check constraint

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT;

DROP INDEX IF EXISTS profiles_username_lower_unique_idx;
CREATE UNIQUE INDEX profiles_username_lower_unique_idx
  ON public.profiles (LOWER(username))
  WHERE username IS NOT NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_format_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format_check
  CHECK (
    username IS NULL
    OR (
      char_length(username) >= 3
      AND char_length(username) <= 30
      AND username ~ '^[a-z0-9_]+$'
    )
  );

DROP POLICY IF EXISTS "Users can update own profile username" ON public.profiles;
CREATE POLICY "Users can update own profile username" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Authenticated users can view usernames" ON public.profiles;
CREATE POLICY "Authenticated users can view usernames" ON public.profiles
  FOR SELECT USING (auth.role() = 'authenticated');


-- ===== 20250101000027_security_events.sql =====
-- Security events log for sign-in monitoring and account audit history
-- Idempotent: safe to apply multiple times.

CREATE TABLE IF NOT EXISTS public.security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('signin', 'password_reset_requested', 'password_reset_completed')),
  ip TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_user_id_created_at
  ON public.security_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_event_type_created_at
  ON public.security_events (event_type, created_at DESC);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "security_events_select_own" ON public.security_events;
CREATE POLICY "security_events_select_own"
  ON public.security_events
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "security_events_service_role_insert" ON public.security_events;
CREATE POLICY "security_events_service_role_insert"
  ON public.security_events
  FOR INSERT
  WITH CHECK (true);

-- ===== 20250101000028_notifications.sql =====
-- Comprehensive in-app notifications system (v2)
-- Migration 20250101000028 failed previously because the original
-- `notifications` table (from 20250101000006) already exists with a
-- different shape (read BOOLEAN, type, message, no read_at).
--
-- This migration ALTERs the existing table to add the new fields and
-- replaces the legacy RLS policies with audience-aware ones.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'audience'
  ) THEN
    ALTER TABLE public.notifications
      ADD COLUMN audience TEXT NOT NULL DEFAULT 'user';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'category'
  ) THEN
    ALTER TABLE public.notifications
      ADD COLUMN category TEXT NOT NULL DEFAULT 'system';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'severity'
  ) THEN
    ALTER TABLE public.notifications
      ADD COLUMN severity TEXT NOT NULL DEFAULT 'info';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'body'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN body TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'read_at'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN read_at TIMESTAMPTZ;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_audience_check') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_audience_check
      CHECK (audience IN ('user', 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_category_check') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_category_check
      CHECK (category IN ('order', 'wallet', 'security', 'system', 'admin_alert'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_severity_check') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_severity_check
      CHECK (severity IN ('info', 'success', 'warning', 'error'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_read_at
  ON public.notifications (user_id, read_at);

CREATE INDEX IF NOT EXISTS idx_notifications_audience_created_at
  ON public.notifications (audience, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created_at
  ON public.notifications (user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Service can insert notifications for users" ON public.notifications;
DROP POLICY IF EXISTS "notifications_select_own_or_admin_audience" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_admin_select_all" ON public.notifications;
DROP POLICY IF EXISTS "notifications_admin_insert" ON public.notifications;
DROP POLICY IF EXISTS "notifications_admin_update_all" ON public.notifications;
DROP POLICY IF EXISTS "notifications_admin_delete_all" ON public.notifications;

CREATE POLICY "notifications_select_own_or_admin_audience"
  ON public.notifications
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR audience = 'admin'
  );

CREATE POLICY "notifications_update_own"
  ON public.notifications
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notifications_admin_select_all"
  ON public.notifications
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "notifications_admin_insert"
  ON public.notifications
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
    OR auth.uid() = user_id
  );

CREATE POLICY "notifications_admin_update_all"
  ON public.notifications
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "notifications_admin_delete_all"
  ON public.notifications
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
    OR auth.uid() = user_id
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;


-- ===== 20250101000029_last_low_balance_email.sql =====
-- Track the last time a low wallet balance notification was emailed to a user
-- Used to debounce LOW_WALLET_BALANCE emails to once per 24 hours.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_low_balance_email_at TIMESTAMPTZ;

-- ===== 20250101000030_notifications_relax_legacy.sql =====
-- Make legacy notifications columns nullable
-- The notifications table originally had type TEXT NOT NULL and message TEXT NOT NULL
-- (from migration 20250101000006). Migration 20250101000028 added new columns
-- (audience, category, severity, body, read_at) but did not relax the legacy
-- NOT NULL constraints, so inserts from the new app code (which writes category +
-- body instead of type + message) fail with "null value in column 'type' violates
-- not-null constraint".
--
-- This migration:
-- 1. Makes `type` and `message` nullable (legacy fields, no longer required).
-- 2. Keeps the data: existing rows still have their old values for back-compat.
-- 3. Adds a default for `category` so even if a caller forgets it, the insert
--    succeeds.
-- 4. Backfills `type` from `category` for any existing rows where type is null,
--    so legacy readers still see something sensible.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'type'
  ) THEN
    ALTER TABLE public.notifications ALTER COLUMN type DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'message'
  ) THEN
    ALTER TABLE public.notifications ALTER COLUMN message DROP NOT NULL;
  END IF;
END $$;

-- Backfill type from category for rows where type is null
UPDATE public.notifications
SET type = category
WHERE type IS NULL AND category IS NOT NULL;


-- ===== 20250101000031_blog_community_tables.sql =====
-- Blog & community content tables
-- Migration for janjez.social blog section

-- Categories for blog posts
CREATE TABLE IF NOT EXISTS public.blog_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  color_hex TEXT DEFAULT '#00A859',
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Main blog posts table
CREATE TABLE IF NOT EXISTS public.blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  content TEXT,
  cover_image_url TEXT,
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  category_id UUID REFERENCES public.blog_categories(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'published', 'rejected', 'archived')),
  visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private', 'members')),
  is_featured BOOLEAN DEFAULT FALSE,
  reading_time_minutes INTEGER DEFAULT 1,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  published_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejection_reason TEXT
);

-- Tags for fine-grained categorization
CREATE TABLE IF NOT EXISTS public.blog_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

-- Many-to-many: posts <-> tags
CREATE TABLE IF NOT EXISTS public.blog_post_tags (
  post_id UUID REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES public.blog_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

-- User ratings (1-5 stars, fractional support via DECIMAL)
CREATE TABLE IF NOT EXISTS public.blog_ratings (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_id UUID REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  rating DECIMAL(2,1) NOT NULL CHECK (rating >= 1.0 AND rating <= 5.0),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

-- Comments with nested replies
CREATE TABLE IF NOT EXISTS public.blog_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.blog_comments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  author_name TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'reported', 'removed')),
  is_reported BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- View tracking
CREATE TABLE IF NOT EXISTS public.blog_post_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ip_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable RLS
ALTER TABLE public.blog_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_post_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_post_views ENABLE ROW LEVEL SECURITY;

-- Categories: read public, admin write
CREATE POLICY "Categories are publicly readable" ON public.blog_categories FOR SELECT USING (TRUE);
CREATE POLICY "Admins can manage categories" ON public.blog_categories
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Posts: only published posts visible to public; authors see their own; admins see all
CREATE POLICY "Public can read published posts" ON public.blog_posts
  FOR SELECT USING (status = 'published' AND visibility IN ('public', 'members'));
CREATE POLICY "Authors can read own posts" ON public.blog_posts
  FOR SELECT USING (auth.uid() = author_id);
CREATE POLICY "Admins can read all posts" ON public.blog_posts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );
CREATE POLICY "Authors can insert draft posts" ON public.blog_posts
  FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "Authors can update own drafts" ON public.blog_posts
  FOR UPDATE USING (auth.uid() = author_id);
CREATE POLICY "Admins can update all posts" ON public.blog_posts
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Tags: public read
CREATE POLICY "Tags are publicly readable" ON public.blog_tags FOR SELECT USING (TRUE);
CREATE POLICY "Admins can manage tags" ON public.blog_tags
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Post tags: public read
CREATE POLICY "Post tags are publicly readable" ON public.blog_post_tags FOR SELECT USING (TRUE);

-- Ratings: public read (average), authenticated users can rate
CREATE POLICY "Ratings are publicly readable" ON public.blog_ratings FOR SELECT USING (TRUE);
CREATE POLICY "Authenticated users can rate" ON public.blog_ratings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own ratings" ON public.blog_ratings
  FOR UPDATE USING (auth.uid() = user_id);

-- Comments: approved comments visible to public; authors see own pending
CREATE POLICY "Public can read approved comments" ON public.blog_comments
  FOR SELECT USING (status = 'approved');
CREATE POLICY "Authors can read own comments" ON public.blog_comments
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Authenticated users can comment" ON public.blog_comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Comment authors can edit own comments" ON public.blog_comments
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins can moderate comments" ON public.blog_comments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Views: authenticated users can log views
CREATE POLICY "Authenticated users can log views" ON public.blog_post_views
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "Views are readable by authenticated users" ON public.blog_post_views
  FOR SELECT USING (TRUE);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON public.blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON public.blog_posts(status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at ON public.blog_posts(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_author ON public.blog_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_category ON public.blog_posts(category_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_featured ON public.blog_posts(is_featured) WHERE is_featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_blog_comments_post ON public.blog_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_blog_comments_parent ON public.blog_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_blog_comments_status ON public.blog_comments(status);
CREATE INDEX IF NOT EXISTS idx_blog_ratings_post ON public.blog_ratings(post_id);
CREATE INDEX IF NOT EXISTS idx_blog_post_views_post ON public.blog_post_views(post_id);
CREATE INDEX IF NOT EXISTS idx_blog_post_tags_tag ON public.blog_post_tags(tag_id);

-- RPC: Increment view count for a blog post
CREATE OR REPLACE FUNCTION public.increment_blog_view(p_post_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.blog_posts
  SET view_count = view_count + 1
  WHERE id = p_post_id;
END;
$$ LANGUAGE plpgsql;


-- ===== 20250101000032_contact_messages.sql =====
-- Contact messages table for admin fulfillment tracking
-- Migration for janjez.social contact form persistence

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  department TEXT DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'read', 'in_progress', 'resolved', 'spam')),
  source TEXT DEFAULT 'contact_form',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for admin queries
CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON public.contact_messages(status);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at ON public.contact_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_department ON public.contact_messages(department);

-- RLS: public can insert, only admin can read/update
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public insert" ON public.contact_messages
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow admin read" ON public.contact_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Allow admin update" ON public.contact_messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );


-- ===== 20250101000033_contact_messages_reply.sql =====
-- Add reply fields to contact_messages table
-- Migration for admin reply system

ALTER TABLE public.contact_messages
  ADD COLUMN IF NOT EXISTS reply_text TEXT,
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replied_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contact_messages_replied_at ON public.contact_messages(replied_at DESC);


-- ===== 20250101000034_orders_retry_and_status.sql =====
-- Add retry tracking columns to orders
-- Run this migration in your Supabase dashboard: SQL Editor

-- Add retry tracking columns
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP WITH TIME ZONE;

-- Add distinct status for disabled fulfillment
-- Update CHECK constraint to include new statuses
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_fulfillment_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_fulfillment_status_check
  CHECK (fulfillment_status IN ('pending', 'processing', 'fulfilled', 'failed', 'cancelled', 'refunded', 'fulfillment_disabled', 'retry_pending'));

CREATE INDEX IF NOT EXISTS idx_orders_retry_count ON public.orders(retry_count);
CREATE INDEX IF NOT EXISTS idx_orders_next_retry_at ON public.orders(next_retry_at) WHERE next_retry_at IS NOT NULL;

-- ===== 20260916000001_orders_payment_method.sql =====
-- Business Side integration — payment method tracking on orders
-- Additive only, nullable, no default. Existing orders remain valid.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_method TEXT;

COMMENT ON COLUMN public.orders.payment_method IS
  'Payment source for Business Side orders: wallet, mpesa, manual. NULL for direct customer orders.';
