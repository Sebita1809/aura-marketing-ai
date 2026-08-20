## ADDED Requirements

### Requirement: One-time link codes live in a reproducible, migrating table
The system SHALL persist one-time Telegram link codes in `public.telegram_link_codes`, defined by an idempotent Supabase migration. The table SHALL have: `id uuid` PRIMARY KEY `DEFAULT gen_random_uuid()`, `chat_id text NOT NULL`, `code` UNIQUE NOT NULL constrained to exactly 6 characters, `expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')`, `used_at timestamptz NULL`, `created_at timestamptz NOT NULL DEFAULT now()`. The migration SHALL create an index on `expires_at`, SHALL enable Row Level Security with no direct-access policies, and SHALL be safe to run both on a fresh schema and on a database where the table already exists.

#### Scenario: Fresh database applies the migration
- **WHEN** the migration runs on a database without `telegram_link_codes`
- **THEN** the table is created with the full schema, and inserting only `{ chat_id, code }` succeeds because `expires_at` is supplied by its DEFAULT (15 minutes ahead)

#### Scenario: Live database already has the table
- **WHEN** the migration runs on a database where `telegram_link_codes` already exists
- **THEN** the existing table and its data are left untouched, and only the missing objects (index, RLS, RPC) are created or aligned

#### Scenario: RLS blocks direct reads while keeping the flow working
- **WHEN** an `authenticated` or anonymous client queries `telegram_link_codes` directly
- **THEN** zero rows are returned (no policies), while the n8n `service_role` insert and the SECURITY DEFINER RPC continue to work

#### Scenario: Rejecting malformed codes at the database
- **WHEN** a row with `code` not equal to 6 characters is inserted
- **THEN** the insert is rejected by the check constraint

### Requirement: The web app finalizes linking through the link_telegram_with_code RPC
The system SHALL expose a `link_telegram_with_code(p_code text)` function that is `SECURITY DEFINER`, sets `search_path = public`, returns a JSON object `{ success, chat_id, error }`, and is executable by the `authenticated` role. It SHALL reject calls where `auth.uid()` is NULL, SHALL look up a code that is unused (`used_at IS NULL`) and not expired (`expires_at > now()`), SHALL set `profiles.telegram_chat_id` to the code's `chat_id` for the calling user, SHALL mark the code as used, and SHALL return the linked `chat_id` on success.

#### Scenario: Valid code links the profile
- **WHEN** an authenticated user calls `link_telegram_with_code` with a code that is unused and not expired
- **THEN** the function returns `{ success: true, chat_id: <chat_id> }`, updates the caller's `profiles.telegram_chat_id`, and sets the code's `used_at`

#### Scenario: Invalid code is rejected
- **WHEN** an authenticated user calls `link_telegram_with_code` with a code that does not exist
- **THEN** the function returns `{ success: false, error: 'Código inválido o expirado.' }` and no profile is updated

#### Scenario: Expired code is rejected
- **WHEN** an authenticated user calls `link_telegram_with_code` with a code whose `expires_at` is in the past
- **THEN** the function returns `{ success: false, error: 'Código inválido o expirado.' }` and no profile is updated

#### Scenario: Already-used code is rejected
- **WHEN** an authenticated user calls `link_telegram_with_code` with a code whose `used_at` is not null
- **THEN** the function returns `{ success: false, error: 'Código inválido o expirado.' }` and no profile is updated

#### Scenario: Unauthenticated call is rejected
- **WHEN** `link_telegram_with_code` is invoked without an authenticated user (e.g. with `service_role`, so `auth.uid()` is NULL)
- **THEN** the function returns `{ success: false, error: ... }` without performing any update

#### Scenario: Missing profile is handled gracefully
- **WHEN** a valid code is provided but no profile exists for `auth.uid()`
- **THEN** the function returns `{ success: false, error: ... }` and the code is not marked as used

### Requirement: The bot validates /start <code> before the normal linking flow
The n8n workflow SHALL route Telegram messages as `Telegram Trigger → Code in JavaScript7 → IF - Vinculacion Telegram`. When the message text starts with `/start `, the bot SHALL query `telegram_link_codes` filtering `code=eq.<code>`, `used_at=is.null` and `expires_at=gt.<now>`, SHALL answer with "✅ Código válido. Completá la vinculación desde la web." when the code is valid or "❌ Código inválido o expirado." when it is not, and SHALL stop there. When the message is not a `/start` command, the flow SHALL continue unchanged through `HTTP - Chequear vinculacion` and the existing linking logic.

#### Scenario: /start with a valid code
- **WHEN** a user sends `/start 123456` and the code is unused and not expired
- **THEN** the bot answers "✅ Código válido. Completá la vinculación desde la web." and the execution stops without reaching the code-generation path

#### Scenario: /start with an invalid or expired code
- **WHEN** a user sends `/start 000000` and the code does not exist, is used, or is expired
- **THEN** the bot answers "❌ Código inválido o expirado." and the execution stops

#### Scenario: /start without a code
- **WHEN** a user sends a bare `/start` with no code
- **THEN** the bot answers "❌ Código inválido o expirado." (the extracted code is empty, no match) without failing

#### Scenario: Normal message keeps the existing flow
- **WHEN** a user sends a message that does not start with `/start `
- **THEN** the flow continues unchanged from `HTTP - Chequear vinculacion` through the existing linking logic, and the validation branch is not executed

#### Scenario: Validation branch never triggers code generation
- **WHEN** a `/start` command reaches the validation branch
- **THEN** the branch terminates after the Telegram answer and does not connect to `Code - Generar código` or `HTTP Request1`

### Requirement: The linking flow is verifiable offline from source
The repository SHALL include a static test (no n8n stack, no containers) that parses `codigo.json` and the migration file and asserts: the workflow parses as JSON with 120 nodes; `IF - Vinculacion Telegram` has an incoming edge from `Code in JavaScript7` and both outputs wired; the four new nodes exist with the expected type, parameters, credentials and retry policy; the validation branch terminates; and there is no regression from prior changes (zero literal secrets, ClamAV chain intact, retry/credentials/TTL policies intact). The test SHALL also assert the migration file exists and contains `CREATE TABLE IF NOT EXISTS` for `telegram_link_codes`, `CREATE OR REPLACE FUNCTION` for `link_telegram_with_code`, and the `GRANT EXECUTE` for `authenticated`.

#### Scenario: Offline test passes on a clean checkout
- **WHEN** `node tests/link-code/verify-link-flow.js` runs on a checkout with the migration and the reworked workflow
- **THEN** it exits 0 and every assertion (structure, wiring, branch termination, no-secrets, migration objects) passes

#### Scenario: Regression checks still pass after the node-count change
- **WHEN** `tests/error-handling/verify-retries.js` and `tests/redis-expiration/verify-ttl.js` run after the rework
- **THEN** they pass with the updated node count (120) and the new `HTTP - Validar codigo` included in the retried-reads set
