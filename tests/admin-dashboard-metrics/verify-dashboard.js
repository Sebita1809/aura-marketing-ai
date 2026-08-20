// Verificación offline del change admin-dashboard-metrics.
// Uso: node tests/admin-dashboard-metrics/verify-dashboard.js
// NO requiere Supabase real ni contenedores (design.md D12): audita
// estáticamente la migración SQL y (cuando el Grupo 5 esté cerrado) el
// ruteo/sidebar del frontend. La verificación viva contra la base real
// (RLS, RPC, idempotencia) se hizo por separado durante el apply con
// `supabase db query --linked` — ver tasks.md 6.6 y el reporte de apply.
//
// Estado (2026-08-18): checks de Grupo 1 (migración) y Grupo 6.3 (deps)
// completos y en verde. Los checks de Grupo 6.2 (App.jsx/Sidebar.jsx) están
// escritos pero DELIBERADAMENTE PENDIENTES DE UNA DECISIÓN: el Grupo 5
// (ruteo/sidebar) no se implementó todavía porque la forma final de la ruta
// (`/admin` vs `/admin/dashboard`, OQ1 de design.md) está esperando
// confirmación explícita del usuario. Ver EXPECTED_ROUTE más abajo.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MIGRATION = path.join(
  ROOT, 'aura-frontend', 'supabase', 'migrations', '20260818140412_usage_events.sql'
);
const APP_JSX = path.join(ROOT, 'aura-frontend', 'src', 'App.jsx');
const SIDEBAR_JSX = path.join(ROOT, 'aura-frontend', 'src', 'components', 'Sidebar.jsx');
const ADMIN_DASHBOARD_JSX = path.join(ROOT, 'aura-frontend', 'src', 'pages', 'AdminDashboard.jsx');
const METRICS_LIB = path.join(ROOT, 'aura-frontend', 'src', 'lib', 'metrics.js');
const PACKAGE_JSON = path.join(ROOT, 'aura-frontend', 'package.json');

// Baseline de dependencias runtime capturado ANTES de tocar nada en este
// change (leído de package.json al empezar el apply, 2026-08-18). El check
// 6.3 exige que este set no crezca — ninguna dependencia nueva (design D11).
const BASELINE_DEPENDENCIES = [
  '@supabase/supabase-js',
  '@tailwindcss/vite',
  'react',
  'react-dom',
  'react-router-dom',
  'tailwindcss',
].sort();

let fallas = 0;
function check(cond, msg) {
  if (cond) {
    console.log('OK   -', msg);
  } else {
    fallas++;
    console.log('FAIL -', msg);
  }
}

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

// ---------- 6.1 — Migración SQL ----------
console.log('--- 6.1 Migración (usage_events, ai_model_prices, admin_dashboard_metrics) ---');

const migrationSql = readIfExists(MIGRATION);
check(migrationSql !== null, `existe ${path.relative(ROOT, MIGRATION)}`);

if (migrationSql !== null) {
  check(
    /CREATE TABLE IF NOT EXISTS public\.usage_events/i.test(migrationSql),
    'usage_events se crea con CREATE TABLE IF NOT EXISTS (idempotente)'
  );
  check(
    /event_key\s+text\s+NOT NULL/i.test(migrationSql) &&
      /UNIQUE\s*\(event_key\)|event_key_key UNIQUE/i.test(migrationSql),
    'usage_events.event_key es NOT NULL y UNIQUE (idempotencia D9)'
  );
  check(
    /event_type_check CHECK/i.test(migrationSql) &&
      /'image_generated'/.test(migrationSql) && /'image_edited'/.test(migrationSql) &&
      /'post_published'/.test(migrationSql) && /'ai_call'/.test(migrationSql),
    'usage_events.event_type tiene el CHECK con los 4 valores esperados'
  );

  check(
    /CREATE TABLE IF NOT EXISTS public\.ai_model_prices/i.test(migrationSql),
    'ai_model_prices se crea con CREATE TABLE IF NOT EXISTS (idempotente)'
  );
  check(
    /unit_check CHECK/i.test(migrationSql) &&
      /'image'/.test(migrationSql) && /'input_token'/.test(migrationSql) && /'output_token'/.test(migrationSql),
    'ai_model_prices.unit tiene el CHECK con los 3 valores esperados'
  );

  check(
    /CREATE INDEX IF NOT EXISTS idx_usage_events_occurred_at/i.test(migrationSql),
    'índice idx_usage_events_occurred_at presente'
  );
  check(
    /CREATE INDEX IF NOT EXISTS idx_usage_events_type_occurred/i.test(migrationSql),
    'índice idx_usage_events_type_occurred presente'
  );
  check(
    /CREATE INDEX IF NOT EXISTS idx_usage_events_user/i.test(migrationSql),
    'índice idx_usage_events_user presente'
  );

  const enablesRlsUsageEvents = /ALTER TABLE public\.usage_events ENABLE ROW LEVEL SECURITY/i.test(migrationSql);
  const enablesRlsPrices = /ALTER TABLE public\.ai_model_prices ENABLE ROW LEVEL SECURITY/i.test(migrationSql);
  check(enablesRlsUsageEvents, 'RLS habilitado en usage_events');
  check(enablesRlsPrices, 'RLS habilitado en ai_model_prices');
  check(
    !/CREATE POLICY/i.test(migrationSql),
    'cero CREATE POLICY en el archivo (D5: la única lectura agregada es el RPC)'
  );

  check(
    /CREATE OR REPLACE FUNCTION public\.admin_dashboard_metrics\(p_from timestamptz, p_to timestamptz\)/i.test(migrationSql),
    'función admin_dashboard_metrics(p_from timestamptz, p_to timestamptz) presente'
  );
  check(
    /SECURITY DEFINER/.test(migrationSql) && /SET search_path = public/.test(migrationSql),
    'admin_dashboard_metrics es SECURITY DEFINER con search_path fijo a public'
  );
  // El chequeo de rol admite dos formas válidas (ambas ligan a
  // profiles.role = 'admin' vía auth.uid()): el check inline literal de
  // design.md D5, o la reutilización de public.is_active_admin() —decisión
  // de apply documentada en el header de la migración y en design.md D5—,
  // que además exige status = 'active'. Cualquiera de las dos satisface el
  // requisito de la spec ("Non-admin call is rejected" / riesgo R7); lo que
  // NO se acepta es la ausencia total de chequeo.
  const hasInlineRoleCheck = /role\s*=\s*'admin'/i.test(migrationSql);
  const hasIsActiveAdminCheck = /is_active_admin\s*\(\s*\)/i.test(migrationSql);
  check(
    hasInlineRoleCheck || hasIsActiveAdminCheck,
    'admin_dashboard_metrics valida rol admin (chequeo inline role=\'admin\' o reuso de is_active_admin())'
  );
  check(
    /RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'/i.test(migrationSql),
    'admin_dashboard_metrics falla con RAISE EXCEPTION forbidden / 42501 (riesgo R7, falla cerrada)'
  );

  check(
    /GRANT EXECUTE ON FUNCTION public\.admin_dashboard_metrics\(timestamptz, timestamptz\) TO authenticated/i.test(migrationSql),
    'GRANT EXECUTE a authenticated presente'
  );
  check(
    !/GRANT EXECUTE ON FUNCTION public\.admin_dashboard_metrics[\s\S]*?TO anon/i.test(migrationSql),
    'sin GRANT EXECUTE a anon (nunca lectura anónima)'
  );
  check(
    /REVOKE ALL ON FUNCTION public\.admin_dashboard_metrics\(timestamptz, timestamptz\) FROM PUBLIC/i.test(migrationSql),
    'REVOKE ALL FROM PUBLIC presente antes del GRANT explícito'
  );
}

// ---------- 6.2 — Frontend: ruteo, sidebar, página, AdminPanel intacto ----------
console.log('--- 6.2 Frontend (ruteo / sidebar / página) ---');

const adminDashboardJsx = readIfExists(ADMIN_DASHBOARD_JSX);
check(adminDashboardJsx !== null, `existe ${path.relative(ROOT, ADMIN_DASHBOARD_JSX)}`);

const metricsLib = readIfExists(METRICS_LIB);
check(metricsLib !== null, `existe ${path.relative(ROOT, METRICS_LIB)}`);
check(
  metricsLib !== null && /admin_dashboard_metrics/.test(metricsLib),
  'lib/metrics.js llama al RPC admin_dashboard_metrics'
);
check(
  adminDashboardJsx !== null && /from ['"]\.\.\/lib\/metrics['"]/.test(adminDashboardJsx),
  'AdminDashboard.jsx consume aura-frontend/src/lib/metrics.js'
);

const appJsx = readIfExists(APP_JSX);
const sidebarJsx = readIfExists(SIDEBAR_JSX);
check(appJsx !== null, `existe ${path.relative(ROOT, APP_JSX)}`);
check(sidebarJsx !== null, `existe ${path.relative(ROOT, SIDEBAR_JSX)}`);

if (appJsx !== null) {
  check(
    /import AdminDashboard from ['"]\.\/pages\/AdminDashboard['"]/.test(appJsx),
    'App.jsx importa AdminDashboard'
  );
  // OQ1 resuelto 2026-08-18: la ruta es /admin (no /admin/dashboard). Se
  // verifica el bloque completo (path="/admin" + requiredRole="admin" +
  // <AdminDashboard />), no solo la presencia suelta del componente, para
  // que el check no sea un tautología que pase con cualquier ruta.
  const adminRouteBlock = appJsx.match(/<Route\s+path="\/admin"[\s\S]*?\/>\s*\n\s*<Route/);
  const hasAdminRoute = !!adminRouteBlock &&
    /requiredRole="admin"/.test(adminRouteBlock[0]) &&
    /<AdminDashboard\s*\/>/.test(adminRouteBlock[0]);
  check(hasAdminRoute, 'App.jsx registra path="/admin" con requiredRole="admin" renderizando <AdminDashboard />');
  check(
    !/path="\/admin\/dashboard"/.test(appJsx),
    'App.jsx NO registra una ruta /admin/dashboard separada (OQ1: se reclamó /admin directamente)'
  );
  check(
    /path="\/admin\/users"/.test(appJsx) && /<UsersPage\s*\/>/.test(appJsx),
    'App.jsx conserva /admin/users -> UsersPage sin tocar'
  );
}

if (sidebarJsx !== null) {
  const dashboardLabelCount = (sidebarJsx.match(/label:\s*'Dashboard'/g) || []).length;
  check(
    dashboardLabelCount === 1,
    `Sidebar.jsx tiene exactamente un ítem con label 'Dashboard' (encontrados: ${dashboardLabelCount})`
  );
  check(
    /path:\s*'\/admin',\s*icon:\s*'dashboard',\s*label:\s*'Dashboard'/.test(sidebarJsx),
    "Sidebar.jsx: el ítem 'Dashboard' apunta a /admin (sin relabel a 'Clientes' — no hizo falta, OQ1)"
  );
}

// AdminPanel.jsx fue reemplazado por UsersPage.jsx en el change hermano
// admin-user-management (archivado, design.md D6 de ese change) ANTES de que
// este change empezara a implementarse — no es una regresión de este change,
// es el estado de partida verificado. Este check documenta esa precondición
// en vez de asumirla en silencio.
const ADMIN_PANEL = path.join(ROOT, 'aura-frontend', 'src', 'pages', 'AdminPanel.jsx');
const USERS_PAGE = path.join(ROOT, 'aura-frontend', 'src', 'pages', 'UsersPage.jsx');
check(
  !fs.existsSync(ADMIN_PANEL) && fs.existsSync(USERS_PAGE),
  'AdminPanel.jsx no existe (ya reemplazado por UsersPage.jsx antes de este change) y este change no lo reintrodujo'
);

// ---------- 6.3 — Sin dependencias nuevas ----------
console.log('--- 6.3 package.json sin dependencias nuevas ---');

const pkgRaw = readIfExists(PACKAGE_JSON);
check(pkgRaw !== null, `existe ${path.relative(ROOT, PACKAGE_JSON)}`);

if (pkgRaw !== null) {
  const pkg = JSON.parse(pkgRaw);
  const currentDeps = Object.keys(pkg.dependencies || {}).sort();
  const added = currentDeps.filter((d) => !BASELINE_DEPENDENCIES.includes(d));
  const removed = BASELINE_DEPENDENCIES.filter((d) => !currentDeps.includes(d));
  check(
    added.length === 0,
    `sin dependencias nuevas en "dependencies" (agregadas: ${added.join(', ') || 'ninguna'})`
  );
  check(
    removed.length === 0,
    `ninguna dependencia existente fue removida (faltantes: ${removed.join(', ') || 'ninguna'})`
  );
}

console.log('');
if (fallas === 0) {
  console.log('TODOS LOS CHECKS PASARON');
  process.exit(0);
} else {
  console.log(`${fallas} CHECK(S) FALLARON`);
  process.exit(1);
}
