## ADDED Requirements

### Requirement: Every incoming binary is validated by magic bytes before any processing
The system SHALL inspect the leading bytes of every binary file received by the Aura Telegram bot (PDF, image and video) and SHALL derive the real file family (`pdf`, `image`, `video`) from those bytes, independently of the `mime_type` declared by Telegram. The validation SHALL run after the file is downloaded from Telegram and BEFORE the file is sent to the antivirus scanner, to Gemini, to Supabase or to Postiz.

Recognised signatures, by family:
- `pdf`: `%PDF-` (`25 50 44 46 2D`) at offset 0
- `image`: `FF D8 FF` (JPEG), `89 50 4E 47 0D 0A 1A 0A` (PNG), `47 49 46 38` (GIF), `52 49 46 46` at offset 0 plus `57 45 42 50` at offset 8 (WEBP)
- `video`: `66 74 79 70` (`ftyp`) at offset 4 (ISO-BMFF: MP4/MOV/3GP), `1A 45 DF A3` (Matroska/WebM)

#### Scenario: PDF with a valid signature continues to the scanner
- **WHEN** a user sends a document declared as `application/pdf` and its first bytes are `%PDF-`
- **THEN** the workflow continues to the `Escaneo ClamAV` node and the PDF pipeline proceeds unchanged

#### Scenario: Image with a valid signature continues to the media pipeline
- **WHEN** a user sends a photo or a document declared as `image/*` whose leading bytes match a known image signature (JPEG, PNG, GIF or WEBP)
- **THEN** the workflow continues to the media antivirus scan and then to `Ruteo por tipo de media`

#### Scenario: Video with a valid signature continues to the media pipeline
- **WHEN** a user sends a video or a document declared as `video/*` whose bytes match `ftyp` at offset 4 or the Matroska magic `1A 45 DF A3`
- **THEN** the workflow continues to the media antivirus scan and then to `Ruteo por tipo de media`

### Requirement: Declared MIME type is never trusted on its own
The system SHALL compare the family derived from the magic bytes against the family declared by Telegram (`message.document.mime_type`, `message.photo`, `message.video`) and SHALL reject the file when they do not match. The declared `mime_type` SHALL NOT be used as the sole basis for accepting a file for processing.

#### Scenario: Executable disguised as a PDF is rejected
- **WHEN** a user sends a document with `mime_type: "application/pdf"` whose real leading bytes are `4D 5A` (Windows PE) or any other non-PDF signature
- **THEN** the workflow rejects the file, notifies the user, and the file does NOT reach `Escaneo ClamAV`, `Analyze document` or Supabase

#### Scenario: Non-image binary disguised as an image is rejected
- **WHEN** a user sends a document with `mime_type: "image/jpeg"` whose leading bytes match no known image signature
- **THEN** the workflow rejects the file, notifies the user, and the file does NOT reach `Moderar imagen Gemini` nor Postiz

#### Scenario: Video declared but not a video container
- **WHEN** a user sends a file declared as `video/mp4` whose bytes contain neither `ftyp` at offset 4 nor the Matroska magic
- **THEN** the workflow rejects the file and notifies the user

### Requirement: Unknown or unreadable binaries are rejected (fail-closed)
The system SHALL reject any file whose signature is not recognised, whose binary payload cannot be read, or for which the validation step errors out. An unrecognised signature SHALL be treated as a rejection, never as an acceptance. The validation node SHALL route its error output to the rejection path using `onError: "continueErrorOutput"` declared as a node property (never inside `parameters`).

#### Scenario: Unrecognised signature is rejected
- **WHEN** the leading bytes of a file match none of the recognised signatures for any family
- **THEN** the workflow rejects the file and notifies the user, and no downstream node (scanner, Gemini, Supabase, Postiz) receives it

#### Scenario: Validation error rejects the file
- **WHEN** the magic-bytes validation node throws (empty binary, unreadable base64, unexpected structure)
- **THEN** the error output routes to the rejection path, the user is notified, and processing stops

### Requirement: Rejection messages are informative but not diagnostic
The system SHALL tell the user that the file was rejected because its content does not match its declared type and what to do next (resend in a standard format), and SHALL NOT disclose the detected signature, the internal rule name or the validation table. Technical detail SHALL be sent to the admin alert channel instead.

#### Scenario: User receives an actionable but non-diagnostic message
- **WHEN** a file is rejected by the signature validation
- **THEN** the Telegram message states that the file does not match its declared type and suggests resending it in a standard format, without revealing detected bytes or rule internals

#### Scenario: Admin receives the technical detail
- **WHEN** a file is rejected by the signature validation
- **THEN** an admin alert records the declared `mime_type`, the derived family (or "unknown") and the `chat_id`, for traceability
