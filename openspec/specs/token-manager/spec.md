## ADDED Requirements

### Requirement: System detects expired or expiring tokens (< 7 days)
The system SHALL run a scheduled check (via a cron-triggered Supabase Edge Function or pg_cron) that queries `social_accounts` for tokens whose `token_expires_at` is in the past or within 7 days.

#### Scenario: Token expired detected by scheduled check
- **WHEN** the scheduled check runs and finds a row where `token_expires_at < NOW()`
- **THEN** the system marks the account as disconnected and triggers the notification flow

#### Scenario: Token expiring within 7 days detected
- **WHEN** the scheduled check runs and finds a row where `token_expires_at` is between `NOW()` and `NOW() + INTERVAL '7 days'`
- **THEN** the system triggers an expiring-soon notification but does not mark the account as disconnected yet

#### Scenario: Token has no expiry date
- **WHEN** the scheduled check runs and finds a row where `token_expires_at IS NULL`
- **THEN** the system skips the row and does not take any action

### Requirement: System marks the account as disconnected (is_connected = false)
When a token is definitively expired, the system SHALL update `social_accounts.is_connected` to `false` and record the disconnection timestamp in `token_metadata`.

#### Scenario: Expired token triggers disconnection
- **WHEN** the system detects an expired token
- **THEN** the system sets `is_connected = false` and writes `disconnected_at` and `disconnect_reason` into the `token_metadata` JSONB column

#### Scenario: Token refresh succeeds before expiry
- **WHEN** the system refreshes the token successfully before `token_expires_at` passes
- **THEN** the system updates the token and expiry and keeps `is_connected = true`

### Requirement: System notifies user (in-app banner or webhook)
When a token expires or is about to expire, the system SHALL create an in-app notification for the user.

#### Scenario: Token expiring soon triggers notification
- **WHEN** a token is within the 7-day window
- **THEN** the system creates an in-app notification with the message "Your [platform] connection will expire on [date]. Reconnect to keep your campaigns publishing."

#### Scenario: Token expired triggers notification
- **WHEN** a token has expired
- **THEN** the system creates an in-app notification with the message "Your [platform] connection has expired. Please reconnect to resume campaign publishing."

#### Scenario: Banner appears on ConnectionsPage
- **WHEN** the user visits ConnectionsPage and has an expired or expiring token
- **THEN** the page displays a warning banner at the top indicating which platform needs attention

### Requirement: For Meta tokens, system attempts refresh if refresh_token is available
The system SHALL call the Meta long-lived token endpoint to attempt a refresh before marking a Meta platform account as disconnected.

#### Scenario: Meta refresh_token exists and refresh succeeds
- **WHEN** the token-manager finds a Meta token that is expired or expiring and a `refresh_token` exists in `token_metadata`
- **THEN** the system calls `https://graph.facebook.com/v20.0/oauth/access_token?grant_type=fb_exchange_token&client_id=...&client_secret=...&fb_exchange_token=...` and updates the stored token and expiry

#### Scenario: Meta refresh_token exists but refresh fails
- **WHEN** the refresh call returns a 4xx/5xx response
- **THEN** the system marks the account as disconnected and notifies the user that the connection could not be renewed

#### Scenario: Meta refresh_token is not available
- **WHEN** the token has no associated `refresh_token`
- **THEN** the system marks the account as disconnected immediately and notifies the user to reconnect

### Requirement: For X tokens, system attempts refresh using refresh_token
The system SHALL call the X OAuth 2.0 token refresh endpoint to renew the token.

#### Scenario: X refresh_token exists and refresh succeeds
- **WHEN** the token-manager finds an X token that is expired or expiring and a `refresh_token` exists
- **THEN** the system calls `https://api.twitter.com/2/oauth2/token?grant_type=refresh_token&refresh_token=...&client_id=...` and updates the stored token and expiry

#### Scenario: X refresh_token exists but refresh fails
- **WHEN** the X refresh call returns a 4xx/5xx response
- **THEN** the system marks the account as disconnected and notifies the user

#### Scenario: X refresh_token is revoked by user
- **WHEN** the X refresh call returns `error=invalid_grant` indicating the refresh token was revoked
- **THEN** the system marks the account as disconnected permanently and notifies the user they must reconnect from scratch
