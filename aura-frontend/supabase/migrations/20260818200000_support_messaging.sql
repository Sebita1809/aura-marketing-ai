-- Migration: Support messaging (tickets + thread) between users and admins
-- Adds public.support_tickets (the request: subject/category/status/owner/
-- last activity) and public.support_messages (the thread: who wrote, body,
-- read_at). RLS-only authorization: a regular user only reaches their own
-- tickets/messages, an admin reaches all of them, via the SECURITY DEFINER
-- helper public.is_admin() (same pattern as disconnect_telegram() in
-- 20260630000002_telegram_link_tokens.sql, used here to avoid recursive RLS
-- on public.profiles). No Edge Function: everything is client
-- INSERT/SELECT/UPDATE governed by these policies. See
-- openspec/changes/support-messaging/design.md (D1, D3, D5) for the full
-- rationale.

-- === Tables =================================================================

CREATE TABLE public.support_tickets (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL,
  subject          text        NOT NULL,
  category         text        NOT NULL,
  status           text        NOT NULL DEFAULT 'open',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_tickets_pkey PRIMARY KEY (id),
  CONSTRAINT support_tickets_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT support_tickets_category_check
    CHECK (category IN ('problema', 'duda', 'sugerencia')),
  CONSTRAINT support_tickets_status_check
    CHECK (status IN ('open', 'answered', 'closed'))
) TABLESPACE pg_default;

CREATE TABLE public.support_messages (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  ticket_id   uuid        NOT NULL,
  sender_id   uuid        NOT NULL,
  sender_role text        NOT NULL,
  body        text        NOT NULL,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_messages_pkey PRIMARY KEY (id),
  CONSTRAINT support_messages_ticket_id_fkey
    FOREIGN KEY (ticket_id) REFERENCES public.support_tickets (id) ON DELETE CASCADE,
  CONSTRAINT support_messages_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES public.profiles (id),
  CONSTRAINT support_messages_sender_role_check
    CHECK (sender_role IN ('user', 'admin'))
) TABLESPACE pg_default;

-- === Indexes =================================================================

CREATE INDEX idx_support_tickets_user_id
  ON public.support_tickets (user_id);

CREATE INDEX idx_support_tickets_last_message_at
  ON public.support_tickets (last_message_at DESC);

CREATE INDEX idx_support_tickets_status
  ON public.support_tickets (status);

CREATE INDEX idx_support_messages_ticket_id_created_at
  ON public.support_messages (ticket_id, created_at);

-- Partial index: both unread badges (user's "admin replied" count and the
-- admin inbox's "user replied" count) filter on read_at IS NULL scoped to a
-- ticket/sender_role, never on the full table.
CREATE INDEX idx_support_messages_unread
  ON public.support_messages (ticket_id, sender_role)
  WHERE read_at IS NULL;

-- === is_admin() helper (SECURITY DEFINER, same pattern as disconnect_telegram()) ===

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- === RLS ======================================================================

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- support_tickets: a user sees/creates only their own; only an admin can
-- change status (close/reopen). No DELETE policy anywhere in this file.
CREATE POLICY "support_tickets_select"
  ON public.support_tickets FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "support_tickets_insert"
  ON public.support_tickets FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "support_tickets_update_admin"
  ON public.support_tickets FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- support_messages: SELECT is scoped to the owning ticket (or admin, all).
-- INSERT validates sender_role/sender_id against the *authenticated*
-- identity, not a client-supplied field -- a user can never insert a message
-- claiming sender_role='admin'. Closed tickets reject new messages from
-- either side.
CREATE POLICY "support_messages_select"
  ON public.support_messages FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = support_messages.ticket_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "support_messages_insert_user"
  ON public.support_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_role = 'user'
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = support_messages.ticket_id
        AND t.user_id = auth.uid()
        AND t.status <> 'closed'
    )
  );

CREATE POLICY "support_messages_insert_admin"
  ON public.support_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
    AND sender_role = 'admin'
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = support_messages.ticket_id
        AND t.status <> 'closed'
    )
  );

-- UPDATE is split by direction of "who is marking whose message as read".
-- Combined with the trigger below and the column-scoped GRANT, this is the
-- only mutation either role can make to an existing message row.
CREATE POLICY "support_messages_update_read_by_user"
  ON public.support_messages FOR UPDATE
  TO authenticated
  USING (
    sender_role = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = support_messages.ticket_id AND t.user_id = auth.uid()
    )
  )
  WITH CHECK (
    sender_role = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = support_messages.ticket_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "support_messages_update_read_by_admin"
  ON public.support_messages FOR UPDATE
  TO authenticated
  USING (public.is_admin() AND sender_role = 'user')
  WITH CHECK (public.is_admin() AND sender_role = 'user');

-- Postgres RLS has no per-column USING/WITH CHECK for UPDATE, so the policies
-- above only restrict *which rows* can be touched, not *which columns*. This
-- GRANT plus the BEFORE UPDATE trigger below close that gap: authenticated
-- users get column-level UPDATE privilege on read_at only, and the trigger
-- rejects any attempted change to any other column even if someone crafts a
-- raw PostgREST PATCH with extra fields.
GRANT UPDATE (read_at) ON public.support_messages TO authenticated;

-- === Triggers =================================================================

-- BEFORE UPDATE: last line of defense so an UPDATE can only ever touch
-- read_at, regardless of what the client sends.
CREATE OR REPLACE FUNCTION public.support_messages_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.ticket_id IS DISTINCT FROM OLD.ticket_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.sender_role IS DISTINCT FROM OLD.sender_role
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'support_messages: only read_at can be updated';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_support_messages_guard_update
  BEFORE UPDATE ON public.support_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.support_messages_guard_update();

-- AFTER INSERT: keeps support_tickets.last_message_at/updated_at and the
-- open/answered/closed transition server-authoritative, computed exactly
-- once, regardless of which side (user or admin) wrote the message. This
-- runs SECURITY DEFINER on purpose: a regular user has no UPDATE policy on
-- support_tickets (only admins do, via support_tickets_update_admin), so
-- without bypassing RLS here the ticket would never advance to 'answered'
-- as intended when it's the *admin's* message.
--
-- BEFORE this trigger touches support_tickets, the incoming INSERT has
-- already been authorized by support_messages_insert_user/_admin above
-- (which independently re-check ticket ownership/closed-state), so this
-- function only ever mutates the ticket that the just-inserted, already
-- policy-checked message belongs to -- it doesn't re-open a broader write
-- path.
CREATE OR REPLACE FUNCTION public.support_messages_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.support_tickets
  SET
    last_message_at = NEW.created_at,
    updated_at = now(),
    status = CASE
      WHEN NEW.sender_role = 'admin' AND status = 'open' THEN 'answered'
      WHEN NEW.sender_role = 'user' AND status = 'answered' THEN 'open'
      ELSE status
    END
  WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_support_messages_after_insert
  AFTER INSERT ON public.support_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.support_messages_after_insert();

-- === Realtime =================================================================

-- RLS is enabled above, BEFORE this ALTER PUBLICATION, on purpose (design.md
-- risk "Fuga por Realtime"): postgres_changes events are filtered by RLS,
-- so a client only ever receives change events for rows its own policies
-- would let it SELECT.
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages, public.support_tickets;
