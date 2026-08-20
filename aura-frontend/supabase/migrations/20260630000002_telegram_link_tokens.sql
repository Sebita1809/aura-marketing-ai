-- Migration: Telegram account linking via deep link token flow
-- Creates a one-time token table so users can connect their Telegram chat_id
-- from the Connections page without the admin needing to manage it manually.

CREATE TABLE public.telegram_link_tokens (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL,
  token      text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_link_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT telegram_link_tokens_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE
) TABLESPACE pg_default;

CREATE INDEX idx_telegram_link_tokens_user_id
  ON public.telegram_link_tokens (user_id);

CREATE INDEX idx_telegram_link_tokens_expires
  ON public.telegram_link_tokens (expires_at);

-- RLS: only the owning user can create / read their tokens.
-- The n8n bot uses the service_role key which bypasses RLS entirely.
ALTER TABLE public.telegram_link_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create own tokens"
  ON public.telegram_link_tokens FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own tokens"
  ON public.telegram_link_tokens FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow authenticated users to clear their own telegram_chat_id (disconnect flow).
-- Uses a security-definer function so the caller never needs broad UPDATE on profiles.
CREATE OR REPLACE FUNCTION public.disconnect_telegram()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles SET telegram_chat_id = NULL WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.disconnect_telegram() TO authenticated;
