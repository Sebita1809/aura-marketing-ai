## ADDED Requirements

### Requirement: Per-chat rate limiting at the bot entry point
The system SHALL enforce a rate limit per Telegram `chat_id` immediately after the `Telegram Trigger`, upstream of the routing node `Code in JavaScript5`, so that an event exceeding the quota consumes no downstream processing (routing, Gemini, ClamAV, Supabase, Postiz). The counters SHALL live in the existing Redis instance using a fixed-window scheme (`INCR` plus `EXPIRE` on first increment) with keys of the form `ratelimit:<chat_id>:<bucket>:<window>`.

#### Scenario: Traffic within quota passes through
- **WHEN** a `chat_id` sends events at a rate below the configured quota
- **THEN** every event continues to `Code in JavaScript5` and the bot behaves exactly as before this change

#### Scenario: Counter expires on its own
- **WHEN** a rate-limit key is created by the first `INCR` of a window
- **THEN** an `EXPIRE` equal to the window length is applied, so the key disappears without any cleanup job

#### Scenario: Limit is enforced before routing
- **WHEN** an event exceeds the quota
- **THEN** the workflow stops at the rate-limit gate and `Code in JavaScript5` is not executed for that event

### Requirement: Separate quotas for text messages and for files
The system SHALL maintain distinct counters for plain-text/callback events (`msg` bucket) and for file uploads (`file` bucket: PDF, image, video). File events SHALL consume both buckets. Each quota SHALL be defined over a short window and a long window, and the thresholds SHALL be configurable within the workflow node without redesign.

#### Scenario: File flood is limited by the file quota
- **WHEN** a `chat_id` sends more files than the configured file quota within the window
- **THEN** the exceeding files are rejected at the gate and never reach the size check, the signature validation, the scanner or Gemini

#### Scenario: Text flood does not consume the file quota
- **WHEN** a `chat_id` sends a burst of text messages within the quota for files but above the message quota
- **THEN** the message quota is the one that triggers, and the file quota remains available for a legitimate upload once the window resets

#### Scenario: Quota resets when the window ends
- **WHEN** the fixed window elapses and the Redis key expires
- **THEN** the next event from the same `chat_id` starts a fresh counter and is processed normally

### Requirement: Single notification per window, then silent discard
The system SHALL notify the user at most once per `chat_id` per window that the quota was exceeded, tracked by an auxiliary Redis key with the same TTL, and SHALL silently discard further events in that window without replying, so the notification cannot be used to amplify abuse.

#### Scenario: First exceeding event notifies the user
- **WHEN** the quota is exceeded for the first time in a window
- **THEN** the bot sends one Telegram message telling the user to slow down, without disclosing the exact threshold

#### Scenario: Subsequent exceeding events are discarded silently
- **WHEN** more events arrive from the same `chat_id` in the same window after the notification
- **THEN** the workflow discards them without sending any message and without further processing

### Requirement: Rate limiter degrades open when Redis is unavailable
The system SHALL let the event through when the Redis counter operation fails or times out, and SHALL record the failure, so an unavailable counter store does not make the bot unusable. This is the only fail-open control of this change; every other input control (size, signature, antivirus) remains fail-closed.

#### Scenario: Redis unreachable does not block the bot
- **WHEN** the Redis node errors or times out during the rate-limit check
- **THEN** the event continues to `Code in JavaScript5` and the failure is recorded for the operator

#### Scenario: Fail-open does not extend to security controls
- **WHEN** the rate limiter degrades open
- **THEN** the downstream size, signature and antivirus controls still apply in full and still fail closed
