-- Add unique constraint on user_id so upsert ?on_conflict=user_id works correctly.
-- One product record per user (product_data jsonb holds the full catalogue).
alter table public.products
  add constraint products_user_id_unique unique (user_id);
