## Why

Actualmente, Aura soporta conexiones simuladas a redes sociales (Instagram, Facebook, Twitter/X) insertando registros directos en Supabase sin flujo OAuth real. Para que el bot de Telegram pueda publicar campañas aprobadas en las cuentas de los usuarios, necesitamos una integración OAuth auténtica que:

- Obtenga tokens de acceso reales con permisos de publicación
- Soporte las 3 plataformas de Meta (Instagram, Facebook, Threads) en un solo flujo de "Facebook Login for Business"
- Soporte X/Twitter de forma independiente (OAuth 2.0)
- Gestione expiración de tokens y notifique desconexiones al usuario

## What Changes

- **Backend**: Nuevas Edge Functions en Supabase para:
  - `auth-meta-callback` — Callback OAuth de Meta que diferencia entre Instagram, Facebook Pages y Threads según los tokens y scopes recibidos
  - `auth-x-callback` — Callback OAuth para X/Twitter
  - `token-manager` — Sistema de monitoreo y renovación de tokens
- **Frontend (ConnectionsPage)**: Agrupar visualmente las 3 plataformas de Meta bajo una sección "Meta / Instagram" y mantener X/Twitter como bloque individual
- **Frontend (ConnectNetworkPage)**: Actualizar para redirigir a URLs de autenticación OAuth real
- **Base de datos**: Ampliar `social_accounts` con campo `platform` que acepte: `instagram`, `facebook`, `threads`, `twitter`; agregar columna `token_metadata` (JSONB) para el Token Manager
- **Dependencias**: Evaluar dependencias de Supabase Edge Functions para manejo de OAuth

## Capabilities

### New Capabilities

- `meta-oauth`: Integración de Facebook Login for Business que cubre Instagram Graph API, Facebook Pages y Threads API en un único flujo OAuth
- `x-twitter-oauth`: Integración independiente de X/Twitter API v2 mediante OAuth 2.0 (PKCE)
- `token-manager`: Sistema de gestión de ciclos de vida de tokens — detección de expiración, alertas al usuario, refresco automático cuando sea posible
- `dashboard-social-connections`: UI de conexiones que agrupa Meta/Instagram y muestra estado de cada plataforma individualmente

### Modified Capabilities

*(Ninguna — es la primera implementación real de OAuth)*

## Impact

- **Frontend**: `ConnectionsPage.jsx`, `ConnectNetworkPage.jsx`, y posiblemente nuevos componentes de UI
- **Backend (Supabase Edge Functions)** : Nuevas funciones: `auth-meta-callback`, `auth-x-callback`, `token-manager`
- **Base de datos**: Migración a `social_accounts` con campos adicionales (`token_metadata JSONB`, `token_expires_at`, `platform_type`)
- **Configuración**: Variables de entorno para Meta App ID/Secret, X API Key/Secret
- **UI/UX**: Cambio visual en ConnectionsPage para agrupar Meta
