## ADDED Requirements

### Requirement: Images and videos are scanned with ClamAV before AI moderation
The system SHALL scan every image and video uploaded through the existing-media publishing flow with the ClamAV service before the file reaches `Ruteo por tipo de media` and therefore before `Moderar imagen Gemini` / `Moderar video Gemini`. The scan SHALL use the already running `clamav-rest` container over the internal Docker network (`POST http://clamav-rest:9000/v2/scan`, `multipart-form-data`, parameter `file` bound to the binary field `data`, timeout at least 60000 ms), reusing the contract already proven in the PDF branch. No new Docker service SHALL be introduced.

#### Scenario: Clean media continues to moderation
- **WHEN** a user uploads an image or a video and the ClamAV scan returns `{"Status": "OK"}`
- **THEN** the workflow continues to `Ruteo por tipo de media` and the existing moderation and publishing flow proceeds unchanged

#### Scenario: Scan runs before the Gemini call
- **WHEN** an uploaded media file is processed
- **THEN** the ClamAV scan happens first, and `Moderar imagen Gemini` / `Moderar video Gemini` are only invoked for files with a clean verdict

#### Scenario: Existing scanner service is reused
- **WHEN** the media scan is performed
- **THEN** it targets the same `clamav-rest` container already used by the PDF branch, and `docker-compose.yml` gains no new service

### Requirement: Infected or unscannable media is rejected and reported
The system SHALL reject any image or video whose scan verdict is not clean, and SHALL also reject it when the scanner is unreachable, times out or returns an unexpected response (fail-closed). Rejected media SHALL NOT reach Gemini, Redis state, or Postiz, and the user SHALL be notified by Telegram. The scan node SHALL declare `onError: "continueErrorOutput"` as a node property (never inside `parameters`), with the error output wired to the same rejection node as the negative verdict.

#### Scenario: Infected image is rejected
- **WHEN** the scan of an uploaded image returns HTTP 406 with `Status: "FOUND"`
- **THEN** the workflow sends a Telegram rejection message, does not call the moderation node, does not store the media in Redis, and does not upload anything to Postiz

#### Scenario: Scanner unreachable rejects the media (fail-closed)
- **WHEN** the media scan HTTP request fails (connection refused, timeout, HTTP 5xx)
- **THEN** the error output routes to the rejection path, the user is notified, and the media does not continue

#### Scenario: Binary survives the scan step
- **WHEN** the scan returns a clean verdict
- **THEN** the original binary is recovered alongside the verdict (merge pattern, as in the PDF branch) so downstream nodes still receive the file

### Requirement: Antivirus and AI content moderation are independent controls
The system SHALL treat the ClamAV scan and the Gemini moderation as two distinct controls that both must pass: the scan answers whether the file is known malware, the moderation answers whether the content violates platform policy. Neither control SHALL be described, configured or relied upon as a substitute for the other.

#### Scenario: Malware in visually inoffensive media is caught by the scanner
- **WHEN** a file with embedded known malware carries visually harmless content
- **THEN** the ClamAV scan rejects it even though the moderation would have approved the content

#### Scenario: Policy-violating but malware-free media is caught by moderation
- **WHEN** a clean, non-malicious file contains content that violates platform policy
- **THEN** the ClamAV scan passes and the existing moderation gate rejects it, with its current behaviour unchanged

#### Scenario: Both verdicts are required to publish
- **WHEN** an uploaded media file is a candidate for publishing
- **THEN** it proceeds only if the antivirus verdict is clean AND the moderation verdict is `apto: true`

### Requirement: Media scanning limits are verified against the 20 MB media cap
The system SHALL ensure the scanner accepts files up to the media size limit enforced by `IF - Límite media existente` (20 MB, and 90 s for video), verifying the `MAX_FILE_SIZE` and `MAX_SCAN_SIZE` settings of the `clamav-rest` container with a real video rather than assuming them.

#### Scenario: A 20 MB video is scanned successfully
- **WHEN** a video at the maximum allowed size is uploaded
- **THEN** the scanner returns a verdict within the configured timeout and the file is not rejected because of scanner limits

#### Scenario: Scanner size limit is documented
- **WHEN** the container limits are verified
- **THEN** the effective values are recorded in the operations notes alongside the existing ClamAV documentation

### Requirement: Reproducible EICAR verification for the media branch
The system SHALL support a reproducible verification of the media branch using the EICAR standard test string, mirroring the procedure already established for the PDF branch, including the documented host-side caveat that Windows Defender blocks reading EICAR files from disk.

#### Scenario: EICAR-laden media file is rejected end to end
- **WHEN** a media file containing the EICAR test string is sent to the bot
- **THEN** the scan reports it as infected, the user receives the rejection message, and nothing is stored or published

#### Scenario: Normal media file is accepted end to end
- **WHEN** a normal image or video is sent to the bot
- **THEN** the scan returns clean and the existing moderation and publishing flow proceeds as before
