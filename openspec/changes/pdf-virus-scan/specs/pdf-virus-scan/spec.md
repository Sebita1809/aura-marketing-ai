## ADDED Requirements

### Requirement: Bot scans incoming PDFs with ClamAV before Gemini analysis
The system SHALL scan every PDF received by the Aura Telegram bot (PDF branch: `Get a file2`) with the ClamAV service before the file is passed to the `Analyze document` (Gemini) node. The scan SHALL be performed via the ClamAV REST API (`POST /v2/scan`, multipart field `file`) exposed by the single `clamav-rest` container (`ajilaag/clamav-rest`, ClamAV daemon + REST in one container), reached by n8n over the internal Docker network.

#### Scenario: Clean PDF reaches Gemini
- **WHEN** a user sends a PDF and the ClamAV scan returns `{"Status": "OK"}`
- **THEN** the workflow continues to the existing `Analyze document` node and the PDF is processed normally

#### Scenario: Scanner REST API is reachable from n8n
- **WHEN** the `clamav-rest` container is up on the `postiz-network` bridge network
- **THEN** n8n can reach `http://clamav-rest:9000/v2/scan` using the internal service port 9000 (the host-published port `8082` is for debugging only)

### Requirement: Malicious or unscannable PDFs are rejected and reported
The system SHALL reject any PDF that the scan marks as infected (`Status != "OK"`) and SHALL NOT pass it to Gemini. The system SHALL also reject the PDF when the scanner is unreachable, times out, or returns an error (fail-closed), and SHALL notify the user via a Telegram message.

#### Scenario: Infected PDF is rejected
- **WHEN** the ClamAV scan returns HTTP `406` with an array entry where `Status` is `"FOUND"` (e.g., `Description: "Eicar-Test-Signature"`)
- **THEN** the workflow sends a Telegram message telling the user the file appears malicious and will not be processed, and the workflow does NOT continue to `Analyze document`

#### Scenario: Scanner unreachable rejects the PDF (fail-closed)
- **WHEN** the `Escaneo ClamAV` HTTP Request errors (connection refused, timeout ≥ 60 s, or HTTP 5xx)
- **THEN** the workflow routes the error output to the rejection path, notifies the user, and does NOT continue to `Analyze document`

#### Scenario: Clean PDF is not rejected
- **WHEN** the scan returns `Status: "OK"`
- **THEN** the workflow does not send a rejection message and continues to `Analyze document`

### Requirement: PDF size limit before scanning
The system SHALL check the size of the incoming PDF before scanning and SHALL reject PDFs larger than a configurable threshold (default 20 MB) with a Telegram notification, without sending them to the scanner.

#### Scenario: Oversized PDF rejected before scanning
- **WHEN** a PDF larger than the configured threshold (default 20 MB) is received
- **THEN** the workflow notifies the user that the file exceeds the size limit and does NOT call the scanner or Gemini

#### Scenario: PDF within size limit is scanned
- **WHEN** a PDF is at or below the configured threshold
- **THEN** the workflow proceeds to the ClamAV scan

### Requirement: Docker stack provides the ClamAV scanner with persistent signatures
The system SHALL provide a single ClamAV container (`ajilaag/clamav-rest`, container `clamav-rest`) that runs the ClamAV daemon and the REST API together, with a persistent named volume `clamav_db:/clamav/data` for virus signatures, the REST API listening on internal port `9000` (host-published `8082:9000` for debugging only), and a healthcheck (`wget -q -O /dev/null http://localhost:9000/version`) with a `start_period: 300s` that accounts for the first-start signature download.

#### Scenario: Services start and become healthy
- **WHEN** `docker compose up -d clamav-rest` is run for the first time
- **THEN** the container eventually reports `healthy` (healthcheck hitting `GET /version` via `wget`) after the initial signature download completes (`start_period: 300s`)

#### Scenario: Signatures persist across restarts
- **WHEN** the `clamav-rest` container is restarted or recreated
- **THEN** the virus signature database is reused from the `clamav_db` named volume (`/clamav/data`) and is not downloaded from scratch

#### Scenario: Host-level debugging endpoint available
- **WHEN** a user runs `curl http://localhost:8082/version` from the host
- **THEN** the REST API responds successfully, confirming the service is up (host-published port is for debugging only; n8n uses the internal port 9000)

### Requirement: EICAR test procedure
The system SHALL support a reproducible verification procedure using the EICAR standard test string embedded in a PDF (malicious case) and a normal PDF (clean case), verified end-to-end through Telegram.

> Note: Windows Defender blocks reading `tests/eicar/eicar-test.pdf` from the host filesystem (PowerShell and `curl` cannot read it: "el archivo contiene un virus"). For host-level API verification without reading files from disk, use `tests/eicar/scan-rest-test.js` (builds the multipart body in memory with the EICAR bytes and POSTs to `/v2/scan`). The real flow is unaffected: the file never touches the host disk (Telegram → n8n memory → `clamav-rest` container).

#### Scenario: EICAR-laden PDF is rejected via Telegram
- **WHEN** a user sends a PDF that contains the EICAR test string (e.g., `X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`)
- **THEN** the scan reports it as infected, the workflow sends the rejection message, and no catalog data is written

#### Scenario: Normal PDF is accepted via Telegram
- **WHEN** a user sends a normal product-catalog PDF that passes the scan
- **THEN** the workflow continues to Gemini, and the user receives the normal catalog-processing result
