# Design: oauth-multi-platform-expansion

## Architecture Overview

The system adds real OAuth authentication for Meta (Facebook Login for Business — covering Instagram, Facebook Pages, and Threads in one flow) and X/Twitter (OAuth 2.0 with PKCE) to replace the current mock/simulated connection records. All OAuth callbacks are hosted as Supabase Edge Functions, consistent with the existing `create-user` function pattern. A Token Manager Edge Function handles token lifecycle monitoring, expiry detection, and user notification.

```
User Browser                Supabase Edge Functions              Meta / X APIs
     │                              │                                │
     │  1. Redirect to OAuth URL    │                                │
     │─────────────────────────────>│                                │
     │                              │  2. Redirect to provider       │
     │<══════════════════════════════╪══════════════════════════════>│
     │                              │                                │
     │  3. User authorizes          │                                │
     │══════════════════════════════>│                                │
     │                              │                                │
     │  4. Callback with auth code  │                                │
     │─────────────────────────────>│                                │
     │                              │  5. Exchange code for token    │
     │                              │───────────────────────────────>│
     │                              │  6. Token + profile data       │
     │                              │<───────────────────────────────│
     │                              │                                │
     │  7. Store in social_accounts │                                │
     │                              │                                │
     │  8. Redirect to /app/connections                              │
     │<─────────────────────────────│                                │
```

## Components

### 1. Meta OAuth Flow (Facebook Login for Business)

- **Responsibility**: Single OAuth redirect that covers Instagram Business accounts, Facebook Pages, and Threads profiles.
- **Location**: `supabase/functions/auth-meta-callback/index.ts`
- **Flow**:
  1. Frontend redirects user to Meta's OAuth dialog with scopes:
     `pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish, threads_basic, threads_content_publish`
  2. User authorizes the app.
  3. Meta redirects to `auth-meta-callback` with a `code` parameter.
  4. The function exchanges the code for a **long-lived user access token** (valid 60 days).
  5. The function queries Meta's Graph API to enumerate connected assets:
     - `GET /me/accounts` → list of pages (each with `id`, `name`, `access_token`)
     - `GET /me?fields=instagram_business_account` → linked IG business accounts
     - `GET /me?fields=threads_profile` → linked Threads profiles
  6. For each asset found, the function inserts (or upserts) a row in `social_accounts` with:
     - `platform`: `instagram` / `facebook` / `threads`
     - `account_id`: the page ID, IG user ID, or Threads profile ID
     - `account_name`: the display name
     - `token_metadata`: JSONB with token_type, scopes, full token payload
     - `token_expires_at`: calculated from `expires_in`
     - `meta_page_id`: for page-scoped tokens (when applicable)
  7. Redirects user to `/app/connections` with success state.

- **Key Design Decision**: The single redirect + enumeration pattern avoids requiring multiple OAuth flows per Meta platform. The user authorizes once, and the backend discovers all available assets.

### 2. X/Twitter OAuth Flow

- **Responsibility**: Independent OAuth 2.0 with PKCE for X/Twitter API v2.
- **Location**: `supabase/functions/auth-x-callback/index.ts`
- **Flow**:
  1. Frontend generates a `code_verifier` and `code_challenge` (SHA-256).
  2. Stores `code_verifier` in `sessionStorage` with a state param for CSRF protection.
  3. Redirects to X's authorize endpoint with scopes:
     `tweet.read tweet.write users.read offline.access`
  4. X redirects to `auth-x-callback` with `code` and `state`.
  5. The function exchanges the code using the stored `code_verifier`.
  6. Stores the resulting access token + refresh token.
  7. Inserts/upserts a `social_accounts` row with:
     - `platform`: `twitter`
     - `account_id`: X user ID
     - `account_name`: X handle/screen_name
     - `token_metadata`: includes `refresh_token`, token_type, scopes
     - `token_expires_at`: 2 hours (access token), refresh token is longer-lived
  8. Redirects to `/app/connections`.

- **Key Design Decision**: PKCE is mandatory for X API v2 (no client secret needed for public apps). The `offline.access` scope ensures we get a refresh token.

### 3. Database Design

#### Current `social_accounts` table (inferred from ConnectionsPage.jsx)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK, default `gen_random_uuid()` |
| `user_id` | UUID | FK to `auth.users` |
| `platform` | text | Currently: `instagram`, `facebook`, `twitter`, `linkedin` |
| `account_name` | text | Display name |
| `account_id` | text | Platform's user/page ID |
| `is_connected` | boolean | Connection status |
| `connected_at` | timestamptz | When connected/disconnected |

#### New columns (migration)

```sql
ALTER TABLE social_accounts
  ADD COLUMN token_metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN token_expires_at TIMESTAMPTZ,
  ADD COLUMN platform_type TEXT CHECK (platform_type IN ('instagram', 'facebook', 'threads', 'twitter', 'linkedin')),
  ADD COLUMN meta_page_id TEXT;
```

| New Column | Type | Purpose |
|---|---|---|
| `token_metadata` | JSONB | Flexible container: `token_type`, `scopes` (array), `refresh_token` (X), `page_access_token` (Meta), raw token payload |
| `token_expires_at` | timestamptz | When the token expires; `NULL` if never expires. Used by Token Manager for expiry monitoring |
| `platform_type` | text | Sub-type discriminator for Meta platforms. `instagram` / `facebook` / `threads` / `twitter` / `linkedin` |
| `meta_page_id` | text | For Meta page-scoped tokens — links a Facebook Page token to the corresponding page ID |

**Migration approach**: A single Supabase migration file at `supabase/migrations/YYYYMMDDHHMMSS_add_oauth_fields.sql`. Since there's no existing migrations folder, this is the first migration. Bootstrapping with `supabase migration new add_oauth_fields`.

**Index strategy**:
```sql
CREATE INDEX idx_social_accounts_user_id ON social_accounts (user_id);
CREATE INDEX idx_social_accounts_token_expires ON social_accounts (token_expires_at) WHERE token_expires_at IS NOT NULL;
```

### 4. Token Manager

- **Responsibility**: Monitor token expiry across all `social_accounts` rows, update `is_connected` on expiry, notify users.
- **Location**: `supabase/functions/token-manager/index.ts`
- **Trigger mechanism**: Scheduled via Supabase's built-in cron (pg_cron extension) or via an external webhook (e.g., n8n workflow that calls the function daily).
- **Behavior**:
  1. Queries `social_accounts` where `token_expires_at IS NOT NULL`.
  2. For tokens expiring within 7 days (warning threshold):
     - X/Twitter: attempt refresh using `refresh_token` from `token_metadata`.
     - Meta: long-lived tokens (60 days) cannot be refreshed programmatically — user must re-authorize. Mark as warning.
  3. For tokens that are expired (`token_expires_at < NOW()`):
     - Set `is_connected = false`.
     - Set `connected_at = NULL`.
  4. Insert a notification row (in a `notifications` table or via Supabase's built-in notification system) for the user.
  5. Return a summary of actions taken.

- **Token metadata schema**:
  ```json
  {
    "token_type": "bearer",
    "scopes": ["tweet.read", "tweet.write", "users.read", "offline.access"],
    "refresh_token": "xxxxx",
    "raw_response": { ... }
  }
  ```

### 5. Frontend Architecture

#### ConnectionsPage restructure

The `networks` array in `ConnectionsPage.jsx` will be restructured into groups:

```
Meta / Instagram (visual section)
  ├── Instagram
  ├── Facebook Page
  └── Threads
X / Twitter (separate section)
LinkedIn (separate section, future)
```

The `networks` array becomes a grouped structure:

```jsx
const platformGroups = [
  {
    groupLabel: 'Meta / Instagram',
    groupIcon: 'meta',
    networks: [
      { id: 'instagram', name: 'Instagram', ... },
      { id: 'facebook', name: 'Facebook Page', ... },
      { id: 'threads', name: 'Threads', ... },
    ],
  },
  {
    groupLabel: 'X',
    networks: [
      { id: 'twitter', name: 'X / Twitter', ... },
    ],
  },
];
```

Each group renders a section with a heading and a sub-grid of cards. The existing card look-and-feel is preserved.

#### ConnectNetworkPage changes

The "Connect" button for each platform triggers a redirect to the respective OAuth URL instead of the current mock `supabase.insert()`:

- **Meta platforms** (instagram, facebook, threads): all redirect to the same Meta OAuth URL. The backend distinguishes them during the enumeration phase in `auth-meta-callback`.
- **X/Twitter**: redirects to X OAuth URL with PKCE challenge.

```js
// For Meta platforms (instagram, facebook, threads):
const META_CLIENT_ID = import.meta.env.VITE_META_APP_ID;
const META_REDIRECT_URI = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-meta-callback`;
const META_OAUTH_URL = `https://www.facebook.com/v22.0/dialog/oauth?client_id=${META_CLIENT_ID}&redirect_uri=${META_REDIRECT_URI}&scope=pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,threads_basic,threads_content_publish&response_type=code&state=${state}`;

// For X/Twitter:
// Generate PKCE challenge, store verifier in sessionStorage, then redirect
```

#### New routes for OAuth callbacks

No new React Router routes are needed. The OAuth callbacks are handled entirely by Supabase Edge Functions (server-side). After the callback processes the token and inserts records, the function redirects the browser to `/app/connections` with a query param:

```
/app/connections?oauth=success&platform=meta
/app/connections?oauth=success&platform=twitter
/app/connections?oauth=error&message=...
```

`ConnectionsPage` checks for these query params on mount and shows a toast/alert.

#### New environment variables

```
VITE_META_APP_ID=xxx
VITE_META_APP_SECRET=xxx
VITE_X_CLIENT_ID=xxx
VITE_X_CLIENT_SECRET=xxx
SUPABASE_URL=xxx (server-side, already exists)
SUPABASE_SERVICE_ROLE_KEY=xxx (server-side, already exists)
```

### 6. OAuth Callback Hosting Decision

**Decision: Supabase Edge Functions (Option A)**

| Aspect | Option A: Edge Functions | Option B: Standalone Server |
|--------|--------------------------|-----------------------------|
| Infrastructure | Already provisioned with the project | Requires new server + deployment pipeline |
| Runtime | Deno (consistent with existing `create-user` function) | Node.js or similar — adds runtime diversity |
| Auth context | Can use `SUPABASE_SERVICE_ROLE_KEY` for direct DB writes | Needs its own Supabase client + service role key |
| Latency | Near-zero cold start (Deno) | Depends on server location |
| Callback URL | `{SUPABASE_URL}/functions/v1/auth-meta-callback` | Separate domain — more CORS/redirect complexity |
| Deployment | `supabase functions deploy` (same workflow) | Separate CI/CD |
| Secrets | Managed via `supabase secrets set` | Environment variables on server |
| Cost | Included in Supabase plan | Additional compute cost |
| Monitoring | Supabase logs | Separate logging setup |

**Recommended: Supabase Edge Functions** — the callback functions (`auth-meta-callback`, `auth-x-callback`, `token-manager`) follow the exact same pattern as the existing `create-user` function. No new infrastructure, consistent Deno runtime, same Supabase project for secrets and DB access.

## Data Model

```sql
-- Add OAuth fields to social_accounts
ALTER TABLE social_accounts
  ADD COLUMN token_metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN token_expires_at TIMESTAMPTZ,
  ADD COLUMN platform_type TEXT CHECK (platform_type IN ('instagram', 'facebook', 'threads', 'twitter', 'linkedin')),
  ADD COLUMN meta_page_id TEXT;

-- Index for token expiry queries
CREATE INDEX idx_social_accounts_token_expires
  ON social_accounts (token_expires_at)
  WHERE token_expires_at IS NOT NULL;
```

**Notes**:
- `platform` remains as-is (the broad platform identifier: `instagram`, `facebook`, `threads`, `twitter`, `linkedin`).
- `platform_type` is the sub-type discriminator. For Meta platforms, both `platform` and `platform_type` will be the same value (e.g., `platform = 'instagram'` AND `platform_type = 'instagram'`). This allows future flexibility (e.g., a single "meta" platform value with multiple sub-types).
- `meta_page_id` is only populated for Facebook Page rows, storing the page ID that issued the page-access token.

## API Changes

### New Edge Functions

| Function | Endpoint | Method | Purpose |
|---|---|---|---|
| `auth-meta-callback` | `{SUPABASE_URL}/functions/v1/auth-meta-callback` | GET | OAuth callback for Meta; receives code, exchanges for token, enumerates assets, writes to DB |
| `auth-x-callback` | `{SUPABASE_URL}/functions/v1/auth-x-callback` | GET | OAuth callback for X/Twitter; receives code+state, exchanges for token+refresh, writes to DB |
| `token-manager` | `{SUPABASE_URL}/functions/v1/token-manager` | POST | Scheduled function; checks expirations, updates statuses, creates notifications |

### No new public REST endpoints
The callback functions are invoked by the OAuth provider (Meta/X), not by the frontend directly. The frontend only reads `social_accounts` via the existing Supabase JS client.

## Sequence Diagrams

### Meta OAuth Flow

```
Frontend                          Supabase (auth-meta-callback)          Meta Graph API
   │                                       │                                │
   │  Redirect to Meta OAuth dialog        │                                │
   │───────────────────────────────────────│───────────────────────────────>│
   │                                       │                                │
   │  User authorizes app                  │                                │
   │<══════════════════════════════════════╪════════════════════════════════│
   │                                       │                                │
   │  GET /auth-meta-callback?code=X       │                                │
   │──────────────────────────────────────>│                                │
   │                                       │                                │
   │                                       │  POST /oauth/access_token      │
   │                                       │  (exchange code)               │
   │                                       │───────────────────────────────>│
   │                                       │  Long-lived user token + ID    │
   │                                       │<───────────────────────────────│
   │                                       │                                │
   │                                       │  GET /me/accounts              │
   │                                       │───────────────────────────────>│
   │                                       │  [pages: {id, name, access_t}]│
   │                                       │<───────────────────────────────│
   │                                       │                                │
   │                                       │  GET /me?fields=instagram_...  │
   │                                       │───────────────────────────────>│
   │                                       │  {ig_user_id}                  │
   │                                       │<───────────────────────────────│
   │                                       │                                │
   │                                       │  GET /me?fields=threads_profile│
   │                                       │───────────────────────────────>│
   │                                       │  {threads_profile_id}          │
   │                                       │<───────────────────────────────│
   │                                       │                                │
   │                                       │  INSERT social_accounts × N    │
   │                                       │  (one per asset found)         │
   │                                       │                                │
   │  302 → /app/connections?oauth=success │                                │
   │<══════════════════════════════════════│                                │
```

### X/Twitter OAuth Flow (PKCE)

```
Frontend                                  Supabase (auth-x-callback)        X API
   │                                           │                            │
   │  Generate code_verifier, store in session │                            │
   │  Compute code_challenge = SHA-256(verifier)│                            │
   │  Redirect to X authorize                  │                            │
   │───────────────────────────────────────────│───────────────────────────>│
   │                                           │                            │
   │  User authorizes                          │                            │
   │<══════════════════════════════════════════╪════════════════════════════│
   │                                           │                            │
   │  GET /auth-x-callback?code=X&state=Y      │                            │
   │──────────────────────────────────────────>│                            │
   │                                           │                            │
   │                                           │  POST /oauth2/token        │
   │                                           │  (code + code_verifier)    │
   │                                           │───────────────────────────>│
   │                                           │  access_token + refresh_t  │
   │                                           │<───────────────────────────│
   │                                           │                            │
   │                                           │  GET /2/users/me           │
   │                                           │───────────────────────────>│
   │                                           │  {id, username, name}      │
   │                                           │<───────────────────────────│
   │                                           │                            │
   │                                           │  INSERT social_accounts    │
   │                                           │                            │
   │  302 → /app/connections?oauth=success     │                            │
   │<══════════════════════════════════════════│                            │
```

## Implementation Notes

### Meta token differentiation logic

The `auth-meta-callback` function must handle the case where a user grants access but has no Instagram business account, no Threads profile, or no Pages. Each of the three enumeration queries can return empty. The function should:

1. Exchange the code → get the long-lived user token + user ID.
2. Query `/me/accounts` → for each page, upsert a `facebook` row with `meta_page_id`.
3. Query `/me?fields=instagram_business_account` → if present, upsert an `instagram` row.
4. Query `/me?fields=threads_profile` → if present, upsert a `threads` row.
5. If no assets found at all, redirect to `/app/connections?oauth=error&message=no_assets`.

### Threads API consideration

Threads API is still in early access / limited availability. The `threads_content_publish` scope may not yet be available for all apps. The design accounts for this: if the scope is rejected, the Threads row simply won't be created. The function handles this gracefully by checking the error response.

### Token Manager scheduling

Option A: Use Supabase's pg_cron extension (if enabled):
```sql
SELECT cron.schedule(
  'token-manager-daily',
  '0 6 * * *',
  $$ SELECT net.http_post(
    url := supabase_url || '/functions/v1/token-manager',
    headers := '{"Authorization":"Bearer ' || service_role_key || '"}'
  ) $$
);
```

Option B: Use n8n to call the endpoint daily (consistent with existing Telegram bot infrastructure). Recommended for now since pg_cron may not be enabled.

### Error states

| Scenario | Behavior |
|---|---|
| User denies OAuth | Provider redirects with `error=access_denied`. Function redirects to `/app/connections?oauth=error&message=access_denied` |
| Token exchange fails | Function returns error page with retry link. Logs to Supabase logs |
| No assets found | Redirect with `?oauth=error&message=no_assets` |
| Token expired (discovered by Token Manager) | `is_connected = false`, user notified. On next visit to ConnectionsPage, card shows "Desconectado" state |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Meta deprecates `threads_content_publish` scope or changes Threads API | The design separates each platform into its own row and upsert logic. If Threads fails, Instagram and Facebook still work. Monitor Meta changelog |
| X/Twitter API rate limits on token refresh | Token Manager runs once daily; rate limits are generous enough for per-user refresh. Add exponential backoff if needed |
| Long-lived Meta tokens expire after 60 days — no programmatic refresh | Token Manager detects imminent expiry (7 days before) and sets `is_connected = false`. User receives a notification to re-authorize. The UX in ConnectionsPage shows a clear "Reconectar" button |
| PKCE state/verifier lost if user closes browser mid-flow | The callback validates `state` against what was stored; if mismatch, redirect to error page. User can retry from ConnectNetworkPage |
| Supabase Edge Function cold start on first call after inactivity | Deno cold starts are typically <200ms. For OAuth callbacks, this is acceptable latency (user is already waiting for auth redirect). If latency becomes an issue, keep function warm via scheduled pings |
| Multiple rows for same user+platform if Meta returns duplicate assets | Use `ON CONFLICT (user_id, platform, account_id) DO UPDATE` with a unique composite index on `(user_id, platform, account_id)` |
| User connects same Instagram account twice via different Meta logins | Prevented by the unique composite index. The second connection updates the existing row rather than creating a duplicate |
