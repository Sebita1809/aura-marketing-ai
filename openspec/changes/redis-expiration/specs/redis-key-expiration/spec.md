## ADDED Requirements

### Requirement: Ephemeral session keys expire via a TTL refreshed on every write
The system SHALL apply an expiration policy to the ephemeral session keys written by the workflow's Redis `set` nodes. Every write to the key families `chat_`, `especificaciones_`, `especificaciones_rehacer_`, `descripcion_` and `publicidad_` SHALL set (and refresh) an expiration on the written key. The built-in Redis node (`n8n-nodes-base.redis`, typeVersion 1) SHALL be used with its native `expire: true` + `ttl` parameters on the `set` operation — n8n performs `client.set(key, value)` followed by `client.expire(key, ttl)` in the same node, so each execution re-arms the TTL. All 21 `set` write nodes SHALL be covered: 16 for `chat_`, 2 for `especificaciones_`, 1 for `especificaciones_rehacer_`, 1 for `publicidad_` and 1 for `descripcion_`. Read nodes (`get`/`llen`/`pop`) and the credentials, key names, state machine and `connections` edges SHALL remain unchanged.

#### Scenario: Every set write carries a TTL
- **WHEN** `codigo.json` is scanned for all Redis nodes using the `set` operation
- **THEN** each of the 21 `set` nodes has `parameters.expire === true` and `parameters.ttl` equal to its key family's constant, and no `set` write exists without an expiration

#### Scenario: TTL is refreshed on each write
- **WHEN** the same key is written a second time (e.g. `Redis19` re-writes `chat_<id>` mid-session)
- **THEN** the expiration is re-armed to the full TTL from the moment of the last write, so an active session never expires mid-flow

#### Scenario: Expiration does not change key names, connections or credentials
- **WHEN** the expiration parameters are applied
- **THEN** every Redis write node keeps its exact key expression, its input/output connections and the `redis` credential, and no new node or edge is added for the string key families

### Requirement: The state-reset node keeps writing an empty string and also expires
The system SHALL keep `Redis13` as a `set` write with the empty-string value (its current reset contract) and SHALL add the family TTL to it. The reset node SHALL NOT be converted to a `delete` operation, because the state evaluator reads the key with `get` and expects a present empty string; a missing key would alter the state machine behavior.

#### Scenario: Reset still writes an empty string with a TTL
- **WHEN** `Redis13` runs to reset the session state
- **THEN** it writes `chat_<id> = ""` with `expire: true` and the `chat_` family TTL, and the key self-deletes 24 h after the reset

### Requirement: The photos list does not persist file ids indefinitely
The system SHALL ensure the `fotos_` list (written via the `push`/LPUSH operation by `Redis6`, which the built-in node cannot TTL) does not leave Telegram `file_id` values in Redis indefinitely. With the approved D2-A mechanism, a Redis Enhanced community node (`@fancyheat/n8n-nodes-redis-enhanced`, `expire` operation) SHALL be added as a dangling fan-out branch from `Redis6`'s output, applying `TTL_FOTOS` to `fotos_<id>` on every photo upload, while `Redis6 → Send a text message7` and all downstream branches keep their exact behavior and item flow.

#### Scenario: Photos list gets a TTL via a dangling expire branch
- **WHEN** D2-A is approved and `Redis6` LPUSHes a photo `file_id` into `fotos_<id>`
- **THEN** the workflow contains an `expire` node on `fotos_<id>` reachable as a fan-out from `Redis6`'s output, that node's output is not consumed by any other node, and `fotos_<id>` self-deletes after `TTL_FOTOS` even if the session is abandoned

#### Scenario: Photo upload flow is unaffected by the expire branch
- **WHEN** D2-A is approved and the workflow runs the photo-upload path
- **THEN** `Send a text message7` and every subsequent node receive exactly the items they received before, because the expire node is a dead-end sink that does not sit in any existing path

#### Scenario: Photos list self-cleans on the happy path without the expire branch
- **WHEN** D2-B is approved (no new dependency) and the flow pops every element of `fotos_<id>`
- **THEN** Redis deletes the list key when its last element is popped, and an abandoned-session sweep procedure (`KEYS fotos_*` + `DEL`) is documented

### Requirement: Expiration policy is verified offline without the live stack
The system SHALL provide an offline verification procedure that does not require the n8n stack or containers: a Node test (`tests/redis-expiration/verify-ttl.js`) that audits `codigo.json` statically — every `set` write has `expire: true` with its family TTL, the count of expiring writes equals the count of write nodes, and the `fotos_` list is handled per the approved decision — and that simulates the `SET` + `EXPIRE` semantics against an in-memory mock, including TTL refresh on re-write.

#### Scenario: Static audit of the workflow export passes
- **WHEN** `node tests/redis-expiration/verify-ttl.js` runs on the host against `codigo.json`
- **THEN** it exits without failure after asserting: all 21 `set` write nodes have `expire: true` and a family-correct `ttl`; the total number of expiring mechanisms equals the number of write nodes (22 with D2-A); no `set` write lacks an expiration; and key names, connections and credentials are untouched

#### Scenario: SET+EXPIRE semantics and TTL refresh are proven against a mock
- **WHEN** the test simulates `client.set(key, value)` then `client.expire(key, ttl)` against an in-memory mock
- **THEN** the mock records the key with TTL seconds remaining equal to the constant, a re-write re-arms the TTL to the full value, and the key is reported expired after the TTL elapses
