# Aura — guía de puesta en marcha

Automatización de marketing digital para redes sociales vía bot de Telegram, construida sobre n8n + Redis + Postiz + Supabase + Google Gemini. Este documento explica qué credenciales hacen falta, cómo conseguirlas, y cómo levantar el proyecto de cero.

## Arquitectura, en una línea

Un bot de Telegram (n8n) genera publicidad con IA (Gemini) a partir de un catálogo de productos (Supabase), y las publica en redes sociales (Instagram/Facebook, vía Postiz). Hay un panel web separado (`aura-frontend/`) para que los usuarios gestionen su cuenta, catálogo y conexiones.

## 1. Requisitos previos

- Docker y Docker Compose.
- Node.js 18+ y `pnpm` (para `aura-frontend/`).
- Una cuenta de [Supabase](https://supabase.com) (plan gratuito alcanza para empezar).
- Un bot de Telegram (gratis, vía [@BotFather](https://t.me/BotFather)).
- Una cuenta de [Google AI Studio](https://aistudio.google.com/) para la API de Gemini.
- Una App de [Meta for Developers](https://developers.facebook.com/) (para publicar en Instagram/Facebook vía Postiz).
- Una forma de exponer n8n públicamente (ngrok, Cloudflare Tunnel, o un dominio propio con reverse proxy — ver `Caddyfile` de ejemplo).

## 2. Credenciales necesarias — qué son y de dónde salen

| Credencial | Dónde se usa | Cómo conseguirla |
|---|---|---|
| **Token de bot de Telegram** | `.env` (`TELEGRAM_BOT_TOKEN`) + credencial `Telegram account` en n8n | Hablarle a [@BotFather](https://t.me/BotFather), `/newbot`, seguir los pasos. |
| **chat_id de admin** (opcional) | `.env` (`DEFAULT_ADMIN_CHAT_ID`) | Hablarle a [@userinfobot](https://t.me/userinfobot) con la cuenta que va a ser admin. |
| **URL pública del panel** | `.env` (`AURA_FRONTEND_URL`, sin slash final) | El dominio donde vive `aura-frontend` (ver §5) — el bot la usa para linkear a `/productos` en el mensaje de confirmación de sobrescritura del catálogo. |
| **API Key de Google Gemini** | Credencial `Google Gemini(PaLM) Api account` en n8n | [Google AI Studio](https://aistudio.google.com/apikey) → Create API Key. |
| **OAuth Client (Google Sheets)** | Credencial `Google Sheets account` en n8n | [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → OAuth 2.0 Client ID (tipo Web application). Habilitar la Google Sheets API. En **Authorized redirect URIs** agregar `<TU_N8N_WEBHOOK_URL>rest/oauth2-credential/callback` (ver §5, es un error común). |
| **Supabase Service Role Key** | Credencial `Supabase Service Role` en n8n (header `apikey`) | Panel de tu proyecto Supabase → Project Settings → API → `service_role` key. **Nunca** exponerla al frontend, solo la usa n8n server-side. |
| **App ID / App Secret de Meta** | `docker-compose.yml` (`FACEBOOK_APP_ID`, hardcodeado — no es secreto) + `.env` (`META_APP_SECRET`) | [Meta for Developers](https://developers.facebook.com/apps/) → crear una App tipo "Business" → agregar el producto "Facebook Login" → copiar App ID y App Secret. Configurar el redirect URI de Postiz ahí también. |
| **API Key de Postiz** | Credencial `Postiz API Key` en n8n (header `Authorization`, **sin** prefijo `Bearer`) | Se genera **después** de levantar Postiz: entrar a la UI de Postiz (puerto 4007 o tu dominio), Settings → API, generar una key nueva. |
| **`POSTIZ_JWT_SECRET`** | `.env` | No se "consigue" de ningún lado — es un string aleatorio que vos generás una vez. Ejemplo (PowerShell): `-join ((48..57)+(65..90)+(97..122)|Get-Random -Count 40|%{[char]$_})` |
| **Credenciales de Supabase para `aura-frontend`** | `aura-frontend/.env` (ver `aura-frontend/.env.example`) | Panel de tu proyecto Supabase → Project Settings → API → `URL` y `anon` key (esta sí es pública, va al frontend). |

## 3. Setup de Supabase (base de datos + edge functions)

```bash
cd aura-frontend
npx supabase login
npx supabase link --project-ref <tu-project-ref>
npx supabase db push          # aplica todas las migraciones de supabase/migrations/
npx supabase functions deploy # despliega las edge functions de supabase/functions/
```

Revisar `supabase/migrations/` para ver el esquema completo (usuarios, productos, mensajería de soporte, rate limiting, etc.).

## 4. Levantar el stack (n8n, Redis, Postiz, ClamAV, Temporal)

```bash
cp .env.example .env
# completar .env con las credenciales del paso 2
docker compose up -d
```

Esto levanta: `n8n` (puerto 5678), `redis`, `clamav-rest` (antivirus para archivos subidos), `postiz` (puerto 4007) + su Postgres/Redis/Temporal, y un healthcheck automático para el worker de Temporal.

## 5. Exponer n8n públicamente y configurar el webhook

n8n necesita ser alcanzable desde internet para que Telegram y Meta le manden webhooks. Opciones:

- **Rápido para probar**: `ngrok http 5678`, tomar la URL que te da y ponerla en `N8N_WEBHOOK_URL` (con `/n8n/` al final). ⚠️ El plan gratuito de ngrok no tiene dominio fijo — si el túnel se reinicia, la URL cambia y hay que actualizar `N8N_WEBHOOK_URL` **y** el redirect URI de Google Cloud Console **y** el de la App de Meta. Para producción real, conviene un dominio propio (ver `Caddyfile` de ejemplo, pensado para servir n8n + `aura-frontend` + Postiz detrás de un mismo dominio).
- Con el dominio/túnel decidido, reiniciar: `docker compose up -d` (recrea los contenedores que dependen de esa URL).

## 6. Importar el flujo a n8n

1. Entrar a n8n (`http://localhost:5678` o tu dominio).
2. Completar el setup inicial de cuenta admin de n8n (primera vez).
3. Menú ⋮ del workflow → **Import from File** → seleccionar `codigo.json`.
4. Ir creando cada credencial listada en la tabla del §2 (n8n te va a marcar qué nodos las necesitan si intentás activar el workflow sin ellas).
5. Activar el workflow.

## 7. Levantar el frontend

```bash
cd aura-frontend
cp .env.example .env   # completar con URL/anon key de Supabase (ver §2)
pnpm install
pnpm dev
```

## 8. Verificar que todo funciona

- Mandarle un mensaje al bot de Telegram — debería responder con el menú principal.
- Entrar al frontend y loguearse.
- Revisar `tests/` para ver la batería de pruebas ya armada (inyección de prompts, validación de firma binaria de archivos, escaneo antivirus) — buena forma de confirmar que la instalación quedó bien antes de usarla con datos reales.

## Notas de seguridad

- **Nunca** commitear `.env` (ya está en `.gitignore`).
- La API Key de Postiz y el Service Role de Supabase viven **solo** como credenciales de n8n (guardadas encriptadas en su base interna) — el export `codigo.json` nunca contiene sus valores, solo referencias por nombre.
- Si en algún momento un secreto termina expuesto en un archivo versionado, rotarlo de inmediato del lado del proveedor (Supabase/Meta/Postiz/Telegram), no alcanza con borrarlo del repo — puede quedar en el historial de git.
