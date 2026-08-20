# Tasks: oauth-multi-platform-expansion

## 1. Base de Datos — Migración de Schema

- [x] 1.1 Ejecutar `supabase migration new add_oauth_fields` para arrancar el directorio de migraciones
- [x] 1.2 Escribir migración SQL que agregue a `social_accounts`: `token_metadata JSONB DEFAULT '{}'::jsonb`, `token_expires_at TIMESTAMPTZ`, `platform_type TEXT CHECK (platform_type IN ('instagram', 'facebook', 'threads', 'twitter', 'linkedin'))`, `meta_page_id TEXT`
- [x] 1.3 Crear índice `idx_social_accounts_token_expires` en `social_accounts (token_expires_at)` con condición `WHERE token_expires_at IS NOT NULL`
- [x] 1.4 Crear índice compuesto único en `(user_id, platform, account_id)` para upsert sin duplicados (`ON CONFLICT DO UPDATE`)
- [x] 1.5 Crear tabla `notifications` con columnas: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `user_id UUID NOT NULL REFERENCES auth.users(id)`, `title TEXT NOT NULL`, `message TEXT NOT NULL`, `type TEXT CHECK (type IN ('token_expiring', 'token_expired', 'info'))`, `platform TEXT`, `is_read BOOLEAN DEFAULT false`, `created_at TIMESTAMPTZ DEFAULT now()`, `read_at TIMESTAMPTZ`
- [x] 1.6 Agregar índice en `notifications (user_id, is_read, created_at)` para consultas eficientes del frontend

## 2. Backend — Meta OAuth Callback Edge Function

- [x] 2.1 Crear `supabase/functions/auth-meta-callback/index.ts` con estructura `serve(async (req) => {...})` siguiendo el patrón de `create-user` (corsHeaders, OPTIONS handler, try/catch)
- [x] 2.2 Extraer `code`, `state` y `error` de query params de la request; si `error=access_denied`, redirigir a `/app/connections?oauth=error&message=access_denied`
- [x] 2.3 Validar `state` contra cookie/header CSRF almacenada en frontend (verificar con cookie o parámetro)
- [x] 2.4 Intercambiar `code` por long-lived user access token via `POST https://graph.facebook.com/v21.0/oauth/access_token` con `client_id`, `client_secret`, `redirect_uri`, `code`
- [x] 2.5 Consultar `GET /me/accounts` para obtener páginas de Facebook con su `page_access_token`; para cada página, insertar/upsert fila en `social_accounts` con `platform='facebook'`, `meta_page_id`, `token_metadata`, `token_expires_at`
- [x] 2.6 Consultar `GET /me?fields=instagram_business_account` para obtener la cuenta de Instagram Business vinculada; si existe, upsert fila `platform='instagram'` con su token
- [x] 2.7 Consultar `GET /me?fields=threads_profile` para obtener perfil de Threads vinculado; si existe, upsert fila `platform='threads'` con su token
- [x] 2.8 Si ninguna de las tres consultas devuelve assets, redirigir a `/app/connections?oauth=error&message=no_assets`
- [x] 2.9 Redirigir al frontend a `/app/connections?oauth=success&platform=meta` tras guardar todas las filas
- [x] 2.10 Manejar errores de Graph API (timeout, 4xx, 5xx) con logging y redirect a error

## 3. Backend — X/Twitter OAuth Callback Edge Function

- [x] 3.1 Crear `supabase/functions/auth-x-callback/index.ts` con estructura `serve(async (req) => {...})` y CORS
- [x] 3.2 Extraer `code`, `state`, `error` de query params; si `error=access_denied`, redirigir a `/app/connections?oauth=error&message=access_denied`
- [x] 3.3 Validar `state` contra el valor almacenado en frontend (verificar mediante sesión o cookie); si mismatch, redirigir con error
- [x] 3.4 Intercambiar `code` por tokens vía `POST https://api.twitter.com/2/oauth2/token` con `grant_type=authorization_code`, `client_id`, `code_verifier` (recibido desde frontend en query param o cookie), `redirect_uri`; recibir `access_token`, `refresh_token`, `expires_in`
- [x] 3.5 Consultar `GET https://api.twitter.com/2/users/me` con el access_token para obtener `id`, `username`, `name`
- [x] 3.6 Insertar/upsert fila en `social_accounts` con `platform='twitter'`, `account_id` (X user ID), `account_name` (handle/username), `token_metadata` (incluye refresh_token, scopes), `token_expires_at` (2 horas desde ahora)
- [x] 3.7 Redirigir a `/app/connections?oauth=success&platform=twitter`
- [x] 3.8 Si el fetch de `/users/me` falla tras token exchange exitoso, guardar fila sin perfil y redirigir con advertencia
- [x] 3.9 Manejar errores de token exchange (PKCE mismatch, invalid_grant) con logging y redirect a error

## 4. Backend — Token Manager Edge Function

- [x] 4.1 Crear `supabase/functions/token-manager/index.ts` con endpoint POST y CORS
- [x] 4.2 Conectar con Supabase usando `SUPABASE_SERVICE_ROLE_KEY` para acceso administrativo
- [x] 4.3 Query a `social_accounts WHERE token_expires_at IS NOT NULL AND token_expires_at < NOW() + INTERVAL '7 days'` para obtener tokens expirados y próximos a expirar
- [x] 4.4 Para tokens X/Twitter con `refresh_token` en `token_metadata`: intentar refresh vía `POST https://api.twitter.com/2/oauth2/token` con `grant_type=refresh_token`; si éxito, actualizar `token_metadata`, `token_expires_at` y mantener `is_connected=true`
- [x] 4.5 Para tokens Meta: intentar refresh vía `GET https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token` con `fb_exchange_token`; si éxito, actualizar token y expiry; si falla, marcar `is_connected=false`
- [x] 4.6 Para tokens expirados sin refresh posible: setear `is_connected=false`, `connected_at=NULL`, escribir `disconnected_at` y `disconnect_reason` en `token_metadata`
- [x] 4.7 Para cada cuenta afectada, insertar fila en `notifications` con `type='token_expiring'` o `'token_expired'`, `platform` correspondiente, `user_id`, título y mensaje descriptivo
- [x] 4.8 Devolver JSON con resumen de acciones: `{ checked: N, refreshed: N, expired: N, notified: N }`
- [x] 4.9 Configurar invocación diaria desde n8n via webhook POST a `{SUPABASE_URL}/functions/v1/token-manager` con header `Authorization: Bearer {service_role_key}`

## 5. Frontend — ConnectionsPage: Agrupación Meta + X

- [x] 5.1 Convertir array plano `networks` en estructura `platformGroups` con dos grupos: `{ groupLabel: 'Meta / Instagram', groupIcon: 'meta', networks: [instagram, facebook, threads] }` y `{ groupLabel: 'X', networks: [twitter] }`
- [x] 5.2 Renderizar cada grupo con un encabezado visual (título + icono) y una sub-grilla de cards dentro del mismo look-and-feel glass-card existente
- [x] 5.3 Actualizar `getAccountStatus` para que evalúe `token_expires_at`: si `is_connected=true` pero `token_expires_at < NOW()`, retornar badge rojo "Token expirado"; si `token_expires_at` próximo a vencer (< 7 días), retornar badge amarillo "Por expirar"
- [x] 5.4 Leer query params `?oauth=success&platform=...` y `?oauth=error&message=...` al montar el componente; mostrar toast/alert de éxito o error según corresponda; limpiar query params de la URL después de mostrar
- [x] 5.5 Conectar botones "Configurar cuenta" / "Conectar cuenta" de Meta (instagram, facebook, threads) para que redirijan a la URL OAuth de Facebook Login (no mock DB insert)
- [x] 5.6 Conectar botón "Configurar cuenta" / "Conectar cuenta" de X para que redirija a la URL OAuth de X con PKCE (no mock DB insert)
- [x] 5.7 Implementar revocación para Meta: botón "Revocar acceso" → llamar a `POST supabase/functions/v1/auth-meta-callback/revoke` (o endpoint dedicado) que invalida token en Meta y setea `is_connected=false`; mostrar diálogo de confirmación antes de revocar
- [x] 5.8 Implementar revocación para X: botón "Revocar acceso" → llamar a `POST https://api.twitter.com/2/oauth2/revoke` vía Edge Function; mostrar diálogo de confirmación
- [x] 5.9 Agregar diálogo de confirmación (modal o alerta) con mensaje "¿Estás seguro de que querés revocar el acceso a [platform]? Las campañas programadas para esta plataforma no se publicarán."
- [x] 5.10 Actualizar fetch de `social_accounts` para incluir también la tabla `notifications` y mostrar contador/badge en icono de campana de notificaciones (cabecera)

## 6. Frontend — ConnectNetworkPage: Redirecciones OAuth Reales

- [x] 6.1 Agregar plataformas faltantes al array `platforms`: `instagram`, `threads`, `twitter` (actualmente solo están tiktok, youtube, linkedin, facebook, pinterest)
- [x] 6.2 Botón "Conectar" de Facebook: redirigir a `https://www.facebook.com/v22.0/dialog/oauth?client_id={VITE_META_APP_ID}&redirect_uri={SUPABASE_URL}/functions/v1/auth-meta-callback&scope=pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,threads_basic,threads_content_publish&response_type=code&state={randomState}`
- [x] 6.3 Botón "Conectar" de Instagram y Threads: redirigir al mismo Meta OAuth URL (se distinguen en backend)
- [x] 6.4 Botón "Conectar" de X/Twitter: generar `code_verifier` aleatorio (43-128 chars), calcular `code_challenge = base64url(sha256(code_verifier))`, almacenar `code_verifier` en `sessionStorage`, redirigir a `https://twitter.com/i/oauth2/authorize?response_type=code&client_id={VITE_X_CLIENT_ID}&redirect_uri={SUPABASE_URL}/functions/v1/auth-x-callback&scope=tweet.read%20tweet.write%20users.read%20offline.access&state={randomState}&code_challenge={challenge}&code_challenge_method=S256`
- [x] 6.5 Generar y almacenar `state` aleatorio en `sessionStorage` para cada plataforma para protección CSRF
- [x] 6.6 Pasar `redirect_uri` correcto a cada proveedor (Meta usa `{SUPABASE_URL}/functions/v1/auth-meta-callback`, X usa `{SUPABASE_URL}/functions/v1/auth-x-callback`)

## 7. Configuración y Variables de Entorno

- [x] 7.1 Agregar a `.env`: `VITE_META_APP_ID`, `VITE_X_CLIENT_ID` (prefijo VITE_ para frontend); documentar en sección del README o archivo de configuración
- [x] 7.2 Setear secrets en Supabase: `supabase secrets set META_APP_SECRET=xxx X_CLIENT_SECRET=xxx`
- [x] 7.3 Verificar que `VITE_SUPABASE_URL` está disponible tanto en frontend (para construir redirect_uri) como en Edge Functions (vía `Deno.env.get('SUPABASE_URL')`)
- [x] 7.4 Configurar URLs de callback en Meta for Developers: `{SUPABASE_URL}/functions/v1/auth-meta-callback` como "Valid OAuth Redirect URI"
- [x] 7.5 Configurar URLs de callback en X Developer Portal: `{SUPABASE_URL}/functions/v1/auth-x-callback` como "Callback URI" y habilitar OAuth 2.0 con PKCE

## 8. UX — Notificaciones de Token Expirado

- [x] 8.1 Crear componente `ExpiryBanner.jsx` que reciba lista de plataformas con token expirado/próximo a expirar y muestre banner de advertencia en parte superior de ConnectionsPage
- [x] 8.2 Banner para tokens expirados: "Tu cuenta de [Platform] se ha desconectado. Por favor volvé a iniciar sesión para seguir publicando." con estilo error (borde rojo, icono de alerta)
- [x] 8.3 Banner para tokens próximos a expirar: "Tu cuenta de [Platform] expirará el [fecha]. Reconectá para mantener tus campañas activas." con estilo warning (borde amarillo, icono de reloj)
- [x] 8.4 Integrar `ExpiryBanner` en `ConnectionsPage`, alimentado por el query de `social_accounts` que verifica `token_expires_at` vs `NOW()`
- [x] 8.5 Renderizar lista de notificaciones desde la tabla `notifications` al hacer clic en el icono de campana en el header; marcar como leídas al abrir
