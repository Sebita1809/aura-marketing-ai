## ADDED Requirements

### Requirement: Network nodes with safe retries carry a retry policy
The system SHALL configure a retry policy on the workflow's network nodes whose transient failure would leave the user hanging and whose repetition is safe (no duplicate user-visible effects). Each such node SHALL carry `parameters.retryOnFail = true`, `parameters.maxTries = 3` and `parameters.waitBetweenTries = 1000`. The covered nodes are: the five Supabase reads (`HTTP - Leer producto informacion`, `HTTP - Leer producto imagen`, `HTTP - Chequear vinculacion`, `HTTP - Perfil publicacion`, `HTTP - Cuenta Instagram publicacion`), the three idempotent Supabase upserts (`HTTP - Upsert producto informacion`, `HTTP - Upsert producto pdf`, `HTTP - Upsert producto imagen`), the Postiz upload (`HTTP - Subir imagen Postiz`), the four Gemini nodes (`Analyze document`, `Analyze an image`, `Generate an image`, `Edit an image`), the agent node `AI Agent1` (which covers its `Google Gemini Chat Model1` subnode and read-only Google Sheets tool), the four Telegram file-download nodes (`Get a file`, `Get a file1`, `Get a file2`, `Telegram Get a file publicacion`) and the 23 Redis write nodes (21 `set`, 1 `push` in `Redis6`, 1 `expire` in `Redis - Expirar fotos`). The failure after exhausting the retries SHALL still stop the execution (no `onError`/`continueOnFail` is added to these nodes).

#### Scenario: Retried nodes expose the standard retry fields
- **WHEN** `codigo.json` is scanned for every node in the retried-nodes list
- **THEN** each node has `parameters.retryOnFail === true`, `parameters.maxTries === 3` and `parameters.waitBetweenTries === 1000`, and no node outside the list has these fields

#### Scenario: Retry fields do not change idempotent behavior
- **WHEN** a Supabase read or an idempotent upsert fails transiently
- **THEN** n8n re-executes the node up to 3 times with a 1 s wait, and the repeated GET or `on_conflict=user_id` POST produces no duplicate rows

#### Scenario: Redis writes retry without changing keys or credentials
- **WHEN** a Redis `set`/`push`/`expire` write fails transiently (e.g. Redis restarting)
- **THEN** the node is re-executed up to 3 times and every write keeps its exact key expression, its `expire`/`ttl` parameters and the `redis` credential

### Requirement: Node types excluded from retries keep no retry policy
The system SHALL NOT add retry configuration to nodes whose retry would be ineffective or would duplicate user-visible effects: the `Telegram Trigger` (entry point), the `Wait` node (intentional pause), the `Escaneo ClamAV` node (keeps its existing `parameters.onError = "continueErrorOutput"`), the 28 Telegram SEND/edit nodes (`sendMessage`, `sendPhoto`, `editMessageText`, `editMessageReplyMarkup`) and the non-idempotent `HTTP - Crear post Postiz` node. `HTTP Request1` (insert into `telegram_link_codes`) SHALL follow the user decision D5: either retry with `maxTries: 2` and a documented duplicate-row risk, or no retry.

#### Scenario: Excluded nodes keep their current configuration
- **WHEN** `codigo.json` is scanned for every node in the excluded list
- **THEN** none of them has `retryOnFail`, and `Escaneo ClamAV` still exposes `parameters.onError = "continueErrorOutput"` while `Telegram Trigger`, `Wait` and `HTTP - Crear post Postiz` have no error configuration added

#### Scenario: A Telegram send failure does not duplicate a user message
- **WHEN** a Telegram SEND node fails (e.g. rate limit) and there is no retry configured
- **THEN** the failure stops the execution once, no duplicate message is sent to the user, and the failure is available to the error notification layer

### Requirement: Workflow structure and node count stay unchanged
The retry configuration SHALL be applied without changing the workflow structure: no node added or removed, the node count stays at 116, the `connections` block stays coherent (every edge points to an existing node), and node names, credentials, key expressions and the state machine remain untouched.

#### Scenario: Structural integrity is verified offline
- **WHEN** `node tests/error-handling/verify-retries.js` runs against `codigo.json`
- **THEN** the JSON parses, the node count is 116, every edge in `connections` points to an existing node, and the three `alwaysOutputData: true` nodes (`HTTP - Leer producto informacion`, `HTTP - Leer producto imagen`, `HTTP - Chequear vinculacion`) still expose it

### Requirement: Retry policy is verified offline without the live stack
The system SHALL provide an offline verification procedure that does not require the n8n stack or containers: a Node test (`tests/error-handling/verify-retries.js`) that audits `codigo.json` statically — every retried node has the three retry fields with the expected values, every excluded node has none, and the ClamAV `onError` and the three `alwaysOutputData` flags are preserved.

#### Scenario: Static audit of the workflow export passes
- **WHEN** `node tests/error-handling/verify-retries.js` runs on the host against `codigo.json`
- **THEN** it exits without failure after asserting the retry fields are present on every retried node, absent on every excluded node, and that ClamAV `onError` and the `alwaysOutputData` flags are preserved
