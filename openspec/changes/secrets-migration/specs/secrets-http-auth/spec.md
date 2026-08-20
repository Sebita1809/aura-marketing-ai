## ADDED Requirements

### Requirement: Supabase HTTP nodes authenticate via a managed Header Auth credential
Each of the 10 Supabase HTTP Request nodes (`Redis`, `Redis1`, `Redis2`, `Redis10`, `Redis21`, `HTTP Request`, `HTTP - Chequear vinculacion`, `HTTP Request1`, `HTTP - Perfil publicacion`, `HTTP - Cuenta Instagram publicacion`) SHALL authenticate to the Supabase REST API through an n8n credential of type Header Auth (`httpHeaderAuth`) named "Supabase Service Role", instead of literal `apikey`/`Authorization` header values embedded in the node parameters. Each node SHALL set `"authentication": "genericCredentialType"` and `"genericAuthType": "httpHeaderAuth"` in its parameters, SHALL NOT contain any literal JWT (`eyJ...`) or `Authorization: Bearer ...` value in `headerParameters`, and SHALL reference the credential via a node-level `credentials.httpHeaderAuth` block with `name: "Supabase Service Role"`. The credential SHALL provide the `apikey` header carrying the `service_role` JWT. The Supabase project URL SHALL remain unchanged in the node URL parameters.

#### Scenario: Supabase node parameters reference the credential instead of literal secrets
- **WHEN** the `codigo.json` export is inspected for any of the 10 Supabase nodes
- **THEN** the node has `authentication: genericCredentialType` with `genericAuthType: httpHeaderAuth`, a `credentials.httpHeaderAuth` block named "Supabase Service Role", and no `apikey` or `Authorization` header parameter whose value contains a JWT

#### Scenario: Supabase requests still authenticate successfully
- **WHEN** the workflow is re-imported into n8n with the "Supabase Service Role" credential associated and a catalog or account-linking request is executed (e.g., GET `/profiles`, POST `/products`, POST `/telegram_link_codes`)
- **THEN** Supabase returns a successful (HTTP 2xx) response with the expected data, functionally equivalent to the previous literal-header behavior

### Requirement: Postiz HTTP nodes authenticate via a managed Header Auth credential
Both Postiz HTTP Request nodes (`HTTP - Subir imagen Postiz` and `HTTP - Crear post Postiz`) SHALL authenticate to `http://postiz:5000/api/public/v1/...` through an n8n credential of type Header Auth (`httpHeaderAuth`) named "Postiz API Key", instead of the literal `Authorization` header value embedded in the node parameters. Each node SHALL set `"authentication": "genericCredentialType"` and `"genericAuthType": "httpHeaderAuth"`, SHALL NOT contain the API key literal in `headerParameters`, and SHALL reference the credential via a node-level `credentials.httpHeaderAuth` block with `name: "Postiz API Key"`. The credential SHALL provide the `Authorization` header with the raw API key value (no `Bearer` prefix), matching the current behavior.

#### Scenario: Postiz node parameters reference the credential instead of the literal API key
- **WHEN** the `codigo.json` export is inspected for `HTTP - Subir imagen Postiz` or `HTTP - Crear post Postiz`
- **THEN** the node has `authentication: genericCredentialType` with `genericAuthType: httpHeaderAuth`, a `credentials.httpHeaderAuth` block named "Postiz API Key", and no `Authorization` header parameter containing the API key literal

#### Scenario: Postiz upload and post creation still work
- **WHEN** the workflow is re-imported into n8n with the "Postiz API Key" credential associated and a publish flow executes (image upload to `/upload` then post to `/posts`)
- **THEN** Postiz accepts the requests (HTTP 2xx) and the post is created, functionally equivalent to the previous literal-header behavior

### Requirement: Non-secret headers are preserved as literal parameters
Headers that do not contain secrets SHALL remain as literal `headerParameters` after the migration: `Prefer: resolution=merge-duplicates` in `Redis1`, `Redis10` and `Redis21` (Supabase upsert nodes), and `Content-Type: application/json` in `HTTP - Crear post Postiz`. Nodes without non-secret headers SHALL have `sendHeaders` disabled and no `headerParameters` block.

#### Scenario: Upsert nodes keep the Prefer header
- **WHEN** the `codigo.json` export is inspected for `Redis1`, `Redis10` or `Redis21`
- **THEN** `headerParameters` contains the literal `Prefer: resolution=merge-duplicates` entry and no secret header entries

#### Scenario: Postiz post node keeps the Content-Type header
- **WHEN** the `codigo.json` export is inspected for `HTTP - Crear post Postiz`
- **THEN** `headerParameters` contains the literal `Content-Type: application/json` entry and no secret header entry

### Requirement: Workflow export contains no literal secrets
The `codigo.json` export SHALL contain no literal secret values after the migration: no JWT (no `eyJ...` substring), no Postiz API key (`704b5278...`), and no `Bearer ` or `apikey` header literals anywhere in the file. The only remaining occurrences of the Supabase project identifier SHALL be the 10 node URL parameters (`supabase.co`), which are endpoints and not secrets. All other workflow behavior (116 nodes, all connections, node ids, positions, bodies and the ClamAV chain from the `pdf-virus-scan` change) SHALL remain intact and the file SHALL remain valid JSON.

#### Scenario: Secret-pattern scan returns zero matches
- **WHEN** a text scan is run over the whole `codigo.json` file for the patterns `eyJ`, the Postiz API key literal, `Bearer ` and `apikey` header values
- **THEN** every pattern matches zero times, while `supabase.co` appears exactly 10 times (the node URLs)

#### Scenario: Export parses and structure is unchanged
- **WHEN** `codigo.json` is parsed as JSON and compared to the pre-migration structure
- **THEN** it parses without error, contains 116 nodes, all `connections` are identical, and the 5 ClamAV-chain nodes (`IF - Límite de tamaño PDF`, `Escaneo ClamAV`, `IF - PDF limpio`, `PDF muy grande`, `PDF rechazado`) are unchanged

### Requirement: Credentials can be created in the n8n UI and the workflow re-imported
The operator SHALL be able to create the two Header Auth credentials ("Supabase Service Role" with header name `apikey`, and "Postiz API Key" with header name `Authorization`) in the n8n UI using the rotated secret values, re-import the migrated `codigo.json` so n8n associates the credentials by name, and confirm the migrated nodes authenticate. This step is pending-manual (requires the running n8n UI and rotated keys).

#### Scenario: Header Auth credentials are created with the planned names
- **WHEN** the operator creates a new HTTP Header Auth credential in n8n Settings
- **THEN** a credential named "Supabase Service Role" exists with header name `apikey` and value set to the rotated `service_role` JWT, and a credential named "Postiz API Key" exists with header name `Authorization` and value set to the rotated Postiz API key

#### Scenario: Re-imported workflow resolves credentials by name
- **WHEN** the operator imports `codigo.json` into n8n and opens any of the 12 migrated nodes
- **THEN** the node shows the expected credential attached (no credential-missing warnings for the migrated auth) and executes authenticated requests

### Requirement: Sanitized export procedure documented for the thesis annex
The project SHALL document a repeatable procedure to produce and verify a sanitized workflow export for the thesis annex (export includes only credential references by id/name, never values; the exported file passes the secret-pattern scan; credential ids are replaced with `<placeholder>`; `pinData` is empty). The procedure SHALL be recorded in `docs/secret-sanitization-procedure.md`.

#### Scenario: Documentation describes the sanitized export steps
- **WHEN** the operator follows `docs/secret-sanitization-procedure.md`
- **THEN** the produced export file contains zero secret patterns (per the scan), no real credential ids, and is suitable to attach as thesis annex [A-50]
