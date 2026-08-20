#!/usr/bin/env node
// Verificación en vivo (no "a ojo") del esquema Supabase tras cada tanda de
// migraciones de user-panel-features. Usa el propio Supabase CLI (ya
// enlazado al proyecto Aura-AI en esta máquina) para volcar el schema
// `public` real y confirma que los objetos esperados de cada grupo están
// presentes con el texto exacto que se aprobó. No corre queries SQL nuevas:
// solo lee lo que `supabase db dump` ya trae, así no necesita ninguna clave
// (el proyecto usa el nuevo formato de API keys de Supabase, que no acepta
// la anon/publishable key para introspección de /rest/v1/, por eso NO se usa
// fetch aquí como en un intento anterior).
//
// Uso: node tests/user-panel-features/verify-schema-live.js --group=1|2|8

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const FRONTEND_DIR = path.join(__dirname, '..', '..', 'aura-frontend');

function dumpSchema() {
  const outFile = path.join(os.tmpdir(), `user-panel-features-schema-${Date.now()}.sql`);
  execFileSync(
    'npx',
    ['--yes', 'supabase', 'db', 'dump', '--linked', '--schema', 'public', '-f', outFile],
    { cwd: FRONTEND_DIR, stdio: 'inherit', shell: true }
  );
  return fs.readFileSync(outFile, 'utf8');
}

function main() {
  const group = (process.argv.find((a) => a.startsWith('--group=')) || '').split('=')[1];
  const sql = dumpSchema();

  const checks = [];
  const assertContains = (label, needle) => checks.push({ label, pass: sql.includes(needle) });

  if (!group || group === '1') {
    assertContains('products: RLS habilitado', 'ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY');
    assertContains('products_select_own existe', 'CREATE POLICY "products_select_own" ON "public"."products"');
    assertContains('profiles_update_own_limited_columns existe', 'CREATE POLICY "profiles_update_own_limited_columns" ON "public"."profiles"');
    assertContains('usage_events_select_own existe', 'CREATE POLICY "usage_events_select_own" ON "public"."usage_events"');
    assertContains('usage_events.event_type CHECK incluye post_scheduled', "'post_scheduled'");
    checks.push({ label: 'usage_events NO tiene columna event_uid duplicada', pass: !sql.includes('"event_uid"') });
  }

  if (!group || group === '2') {
    assertContains('products.updated_at existe', '"updated_at"');
    assertContains('trigger de updated_at en products', 'products_set_updated_at');
    assertContains('products_product_data_is_array CHECK existe', 'products_product_data_is_array');
    assertContains('RPC product_catalog_add existe', 'FUNCTION "public"."product_catalog_add"');
    assertContains('RPC product_catalog_remove existe', 'FUNCTION "public"."product_catalog_remove"');
    assertContains('RPC product_catalog_upsert_for_user existe', 'FUNCTION "public"."product_catalog_upsert_for_user"');
    assertContains('helper product_item_normalized_name existe', 'FUNCTION "public"."product_item_normalized_name"');
  }

  if (group === '8') {
    assertContains('trigger de sync de email en auth.users', 'on_auth_user_email_updated');
    assertContains('función sync_profile_email existe', 'FUNCTION "public"."sync_profile_email"');
  }

  let failed = 0;
  for (const c of checks) {
    if (c.label === undefined) continue;
    console.log(`${c.pass ? 'PASS' : 'FAIL'} - ${c.label}`);
    if (!c.pass) failed++;
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks pasaron.`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
