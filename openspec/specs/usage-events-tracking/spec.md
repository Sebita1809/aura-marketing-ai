## ADDED Requirements

### Requirement: Usage events are persisted in a reproducible append-only table
The system SHALL persist every billable or countable action of the product in `public.usage_events`, defined by an idempotent Supabase migration. The table SHALL have: `id uuid` PRIMARY KEY `DEFAULT gen_random_uuid()`, `event_key text NOT NULL UNIQUE`, `event_type text NOT NULL` constrained to `('image_generated','image_edited','post_published','ai_call')`, `user_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL`, `telegram_chat_id text NULL`, `provider text NOT NULL DEFAULT 'google'`, `model text NULL`, `quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0)`, `input_tokens integer NULL`, `output_tokens integer NULL`, `metadata jsonb NOT NULL DEFAULT '{}'::jsonb`, `occurred_at timestamptz NOT NULL DEFAULT now()`, `created_at timestamptz NOT NULL DEFAULT now()`. The migration SHALL create indexes on `occurred_at`, on `(event_type, occurred_at)` and on `user_id`, and SHALL be safe to run repeatedly.

#### Scenario: Fresh database applies the migration
- **WHEN** the migration runs on a database without `usage_events`
- **THEN** the table, its constraints and its three indexes are created, and inserting only `{ event_key, event_type }` succeeds because every other column has a DEFAULT or is nullable

#### Scenario: Migration runs twice
- **WHEN** the migration is applied a second time on a database that already has `usage_events` with rows
- **THEN** it completes without error and no existing row is modified or deleted

#### Scenario: Unknown event type is rejected at the database
- **WHEN** a row with `event_type = 'something_else'` is inserted
- **THEN** the insert is rejected by the check constraint

#### Scenario: Deleting a profile keeps its usage history
- **WHEN** a `profiles` row referenced by existing events is deleted
- **THEN** the events remain, with `user_id` set to NULL and `telegram_chat_id` preserved

### Requirement: Duplicate event submissions are ignored
Every event SHALL carry a caller-supplied `event_key` that uniquely identifies the producing execution, node and item (format `<execution_id>:<node_name>:<item_index>`), and the database UNIQUE constraint SHALL be the mechanism that prevents double counting on producer retries.

#### Scenario: Retried write does not double count
- **WHEN** the producer POSTs the same `event_key` twice (n8n retry or re-run) with header `Prefer: resolution=ignore-duplicates`
- **THEN** exactly one row exists for that `event_key` and metric totals are unchanged by the second write

#### Scenario: Missing event key is rejected
- **WHEN** an event is inserted without `event_key`
- **THEN** the insert fails on the NOT NULL constraint

### Requirement: AI model prices are versioned and separate from the events
The system SHALL store estimated list prices in `public.ai_model_prices` with `model text NOT NULL`, `unit text NOT NULL` constrained to `('image','input_token','output_token')`, `unit_cost_usd numeric(12,8) NOT NULL`, `effective_from timestamptz NOT NULL DEFAULT now()`, `is_estimate boolean NOT NULL DEFAULT true`, and `notes text NULL`, UNIQUE on `(model, unit, effective_from)`. Cost SHALL NOT be stored on the event rows; it SHALL be derived at read time from the price row with the greatest `effective_from` that is not later than the event's `occurred_at`.

#### Scenario: Correcting a price does not rewrite history
- **WHEN** a new price row for the same `model` and `unit` is inserted with a later `effective_from`
- **THEN** events that occurred before that date keep being costed at the previous price, and only later events use the new one

#### Scenario: Model without a price row
- **WHEN** events reference a `model` that has no matching row in `ai_model_prices`
- **THEN** those events contribute `0` to the cost total and are reported in the per-model breakdown flagged as unpriced, instead of failing the query

#### Scenario: Migration seeds prices marked as estimates
- **WHEN** the migration runs
- **THEN** price rows for `models/gemini-3-pro-image-preview` (unit `image`) and `models/gemini-2.5-flash` (units `input_token` and `output_token`) exist with `is_estimate = true` and a `notes` value stating the assumption used

### Requirement: Usage tables are not directly readable by web clients
`usage_events` and `ai_model_prices` SHALL have Row Level Security enabled with no SELECT, INSERT, UPDATE or DELETE policy granted to `anon` or `authenticated`. Writes SHALL be performed exclusively with the `service_role` credential, and reads exclusively through the aggregation RPC.

#### Scenario: Authenticated client cannot read the raw log
- **WHEN** a signed-in user (including an admin) queries `usage_events` directly with the anon key
- **THEN** zero rows are returned

#### Scenario: Service role writes succeed
- **WHEN** the producer inserts an event using the `service_role` key
- **THEN** the row is written, because `service_role` bypasses RLS

### Requirement: A single admin-only RPC returns all dashboard aggregates
The system SHALL expose `public.admin_dashboard_metrics(p_from timestamptz, p_to timestamptz) RETURNS json`, declared `SECURITY DEFINER SET search_path = public`, with `EXECUTE` granted to `authenticated` only. Its first statement SHALL verify that a `profiles` row exists with `id = auth.uid()` and `role = 'admin'`, raising an exception otherwise. On success it SHALL return a single JSON object containing: client counts (total and active), estimated Google AI cost in USD for the period, published post count, image counts (total, new, redone), a per-model cost breakdown, a daily series of images and posts, the timestamp of the first and last recorded event, and the period boundaries used.

#### Scenario: Non-admin call is rejected
- **WHEN** a signed-in user whose `profiles.role` is not `'admin'` calls the RPC
- **THEN** the call fails with an authorization error and no aggregate data is returned

#### Scenario: Anonymous call is rejected
- **WHEN** the RPC is called without an authenticated session (`auth.uid()` is NULL)
- **THEN** the call fails with the same authorization error

#### Scenario: Admin call returns every aggregate in one round trip
- **WHEN** an admin calls the RPC with a 30-day window
- **THEN** one JSON object is returned containing all KPI values, the per-model breakdown, the daily series and the first/last event timestamps, without the client issuing any further query

#### Scenario: Empty period returns zeros and null boundaries, not an error
- **WHEN** an admin calls the RPC for a period with no events
- **THEN** the counters are `0`, the breakdown and series are empty arrays, and the first/last event timestamps are `null`

### Requirement: Metrics are computed over well-defined counting rules
The RPC SHALL count clients from `profiles` (total rows, and rows with `is_active` not false as active) independently of the period; images as the sum of `quantity` over `image_generated` (reported as new) plus `image_edited` (reported as redone), with the total being the sum of both; published posts as the sum of `quantity` over `post_published`; and estimated cost as the sum over all event types of `quantity × price(unit='image')` for image models plus `input_tokens × price(unit='input_token') + output_tokens × price(unit='output_token')` where token counts are present. Daily series buckets SHALL be computed as `date_trunc('day', occurred_at AT TIME ZONE 'America/Argentina/Buenos_Aires')`.

#### Scenario: A redone image counts toward the total
- **WHEN** a user generates one image and then regenerates or edits it twice
- **THEN** the image KPI reports a total of `3`, broken down as `1` new and `2` redone

#### Scenario: One post published to several platforms
- **WHEN** a single publication is sent to Instagram and Facebook and is logged with `quantity = 2` and the platform list in `metadata`
- **THEN** the published-post KPI counts `2`

#### Scenario: Cost combines image and token pricing
- **WHEN** the period contains image events for a priced image model and text events carrying `input_tokens` and `output_tokens` for a priced text model
- **THEN** the estimated cost is the sum of both contributions, and the per-model breakdown attributes each amount to its model

#### Scenario: Period filtering applies to usage but not to client count
- **WHEN** an admin narrows the period to the last 7 days
- **THEN** cost, posts and images only reflect events within that window, while the client counters still reflect all existing profiles

### Requirement: The event contract for producers is documented in the repository
The repository SHALL contain `docs/usage-events-contract.md` describing, for each `event_type`, the exact JSON payload, the endpoint (`POST /rest/v1/usage_events`), the required credential ("Supabase Service Role"), the `Prefer: resolution=ignore-duplicates` header, the `event_key` format, and the workflow nodes after which each event is expected to be emitted. It SHALL state that a failure to log an event MUST NOT interrupt the user-facing flow that produced it.

#### Scenario: Implementer of the n8n change has an unambiguous contract
- **WHEN** the sibling change that instruments `codigo.json` is implemented
- **THEN** the document provides a copy-ready payload per event type and the node insertion points, requiring no design decisions from the implementer

#### Scenario: Logging failure does not break publishing
- **WHEN** the usage-event insert fails (network error, Supabase down)
- **THEN** the documented contract requires the producing branch to continue, so the image is still delivered and the post is still published
