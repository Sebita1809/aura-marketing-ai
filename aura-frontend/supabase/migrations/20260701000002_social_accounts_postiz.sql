-- Add postiz_integration_id to social_accounts.
-- Stores the Postiz Integration.id so n8n can publish to social media via Postiz.
alter table public.social_accounts
  add column if not exists postiz_integration_id text;

-- Seed existing accounts with their known Postiz integration IDs.
-- These were created manually in Postiz during initial setup.
update public.social_accounts
  set postiz_integration_id = 'cmr03c2mg0001qm9egwqqhb8u'
  where account_id = '17841410067378542'
    and platform_type = 'instagram';

update public.social_accounts
  set postiz_integration_id = 'cmr0tm3uf0001my84q2eu5659'
  where account_id = '1134939813045274'
    and platform_type = 'facebook';
