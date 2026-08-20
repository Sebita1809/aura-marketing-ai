-- Migration: OAuth Multi-Platform Expansion
-- Adds support for Meta (Instagram/Facebook/Threads) and X platform tokens
-- Adds composite unique index and token expiry index

-- Add new columns to social_accounts
ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS token_metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS platform_type TEXT,
  ADD COLUMN IF NOT EXISTS meta_page_id TEXT;

-- Add check constraint for platform_type
ALTER TABLE social_accounts
  ADD CONSTRAINT social_accounts_platform_type_check
  CHECK (platform_type IS NULL OR platform_type IN ('instagram', 'facebook', 'threads'));

-- Create composite unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_accounts_user_platform_account
  ON social_accounts (user_id, platform, account_id);

-- Create index for expiry queries
CREATE INDEX IF NOT EXISTS idx_social_accounts_token_expires_at
  ON social_accounts (token_expires_at)
  WHERE token_expires_at IS NOT NULL;
