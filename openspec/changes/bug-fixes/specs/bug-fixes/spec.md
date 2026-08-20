## ADDED Requirements

### Requirement: Account-link codes use a cryptographically secure random generator
The system SHALL generate the 6-digit account-linking code in the `Code - Generar código` node using Node.js `crypto.randomInt(100000, 1000000)` instead of `Math.random()`. The node SHALL keep extracting `chat_id` from `$('Code in JavaScript7').first().json.id_chat` and SHALL keep returning the output shape `[{ json: { code, chat_id } }]`. The n8n container SHALL run with the environment variable `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (minimum privilege) so the Code node can import the built-in `crypto` module.

#### Scenario: Generated code is a six-digit number in the valid range
- **WHEN** the `Code - Generar código` node generates a linking code
- **THEN** the code is an integer in `[100000, 999999]` (a 6-digit string) produced by `crypto.randomInt(100000, 1000000)`

#### Scenario: Consecutive generations produce varying codes
- **WHEN** the linking-code algorithm is invoked repeatedly (e.g., 200 times)
- **THEN** the produced codes are not all identical (at least two distinct values are observed), confirming the generator is not deterministic

#### Scenario: Node output contract is preserved
- **WHEN** the node runs with a valid `chat_id` available from `Code in JavaScript7`
- **THEN** it returns a single item with `json.code` (6-digit string) and `json.chat_id` (the chat id as string)

#### Scenario: Code node may import the crypto builtin module
- **WHEN** the n8n container runs with `NODE_FUNCTION_ALLOW_BUILTIN=crypto` set in its environment
- **THEN** `const { randomInt } = require('crypto')` executes without a sandbox permission error in the Code node

### Requirement: Broken HTTP Request node with literal placeholder is removed and the products branch is reconnected
The system SHALL remove the `HTTP Request` node (URL `.../profiles?telegram_chat_id=eq.{chat_id}&select=id` with the literal `{chat_id}` placeholder) from the workflow, along with its connection edges, and SHALL reconnect `Code in JavaScript` directly to the product upsert node (`HTTP - Upsert producto informacion`, formerly `Redis1`), mirroring the sibling branch `Code in JavaScript6 → HTTP - Upsert producto imagen`. After removal the workflow SHALL contain 115 nodes.

#### Scenario: Dead node is removed from the workflow
- **WHEN** the `HTTP Request` node (literal `{chat_id}` URL) is removed
- **THEN** the node no longer exists in the `nodes` array and no connection entry in `connections` references or originates from it

#### Scenario: Products upsert branch remains connected
- **WHEN** `Code in JavaScript` outputs the parsed product items
- **THEN** `HTTP - Upsert producto informacion` receives those items directly (the branch mirrors `Code in JavaScript6 → HTTP - Upsert producto imagen`)

#### Scenario: No dangling connections remain
- **WHEN** the removal and reconnection are applied
- **THEN** every `connections` entry points to an existing node, `Code in JavaScript` has exactly two downstreams (`Code in JavaScript2` and `HTTP - Upsert producto informacion`), and no node references the removed node by name

### Requirement: Misleadingly named HTTP nodes are renamed descriptively
The system SHALL rename the three `n8n-nodes-base.httpRequest` nodes `Redis1`, `Redis10` and `Redis21` (all `POST .../rest/v1/products?on_conflict=user_id` against Supabase) to `HTTP - Upsert producto informacion`, `HTTP - Upsert producto pdf` and `HTTP - Upsert producto imagen` respectively, and SHALL update every occurrence (node `name` field and `connections` entries) so that no reference to the old names remains.

#### Scenario: All three node names are updated
- **WHEN** the rename is applied
- **THEN** the workflow contains nodes named `HTTP - Upsert producto informacion`, `HTTP - Upsert producto pdf` and `HTTP - Upsert producto imagen`, and no node is named `Redis1`, `Redis10` or `Redis21`

#### Scenario: Zero stale references remain after rename
- **WHEN** the rename is applied and the full file is searched with exact quoted matches
- **THEN** there are zero occurrences of `"Redis1"`, `"Redis10"`, `"Redis21"` and zero occurrences of `$('Redis1')`, `$('Redis10')`, `$('Redis21')` in `codigo.json` (exact matching so `Redis1` does not collide with `Redis10`, nor `Redis2` with `Redis21`)

#### Scenario: Connections remain consistent after rename
- **WHEN** the rename is applied
- **THEN** `HTTP - Upsert producto pdf` is reachable from `Code in JavaScript1`, `HTTP - Upsert producto imagen` is reachable from `Code in JavaScript6` and feeds `Mensaje predeterminado1`, and `HTTP - Upsert producto informacion` is reachable from `Code in JavaScript`

### Requirement: Offline integrity verification does not require the live stack
The system SHALL provide a verification procedure that runs without the n8n stack or containers: a Node test for the link-code algorithm (`tests/rng/test-link-code.js`) and an integrity check of `codigo.json` that parses, counts nodes, validates connections, and confirms the absence of `Math.random` and of stale node-name references.

#### Scenario: Link-code algorithm is verified offline
- **WHEN** `node tests/rng/test-link-code.js` is run on the host
- **THEN** it exits without failure after asserting the 6-digit range, the string length, and the variability across consecutive invocations

#### Scenario: Workflow export remains a valid, coherent JSON
- **WHEN** `codigo.json` is parsed after the edits (e.g., `Get-Content -Raw | ConvertFrom-Json` or `require('./codigo.json')`)
- **THEN** it parses without error, contains exactly 115 nodes, every `connections` edge references existing nodes, `pinData` is empty, and the ClamAV nodes and credentials from the previous changes are intact

#### Scenario: No insecure random or stale names remain in the export
- **WHEN** the full raw text of `codigo.json` is searched
- **THEN** there are zero occurrences of `Math.random`, `"Redis1"`, `"Redis10"` and `"Redis21"`
