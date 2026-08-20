## ADDED Requirements

### Requirement: User can initiate X OAuth with PKCE from ConnectNetworkPage
The system SHALL redirect the user to the X/Twitter OAuth 2.0 authorization endpoint using the PKCE flow when they click "Connect X/Twitter" on the ConnectNetworkPage.

#### Scenario: User clicks Connect X/Twitter on ConnectNetworkPage
- **WHEN** the user clicks "Connect X/Twitter" button
- **THEN** the system generates a `code_verifier` and `code_challenge` (SHA-256), stores the `code_verifier` in session state, and redirects to `https://twitter.com/i/oauth2/authorize` with `response_type=code`, `client_id`, `redirect_uri`, `state`, `code_challenge`, and `code_challenge_method=S256`

#### Scenario: OAuth redirect with valid state and code
- **WHEN** X redirects back with a valid `state` and an `authorization_code`
- **THEN** the `auth-x-callback` Edge Function exchanges the code for tokens using the stored `code_verifier` and the `/oauth2/token` endpoint

#### Scenario: OAuth redirect with invalid state
- **WHEN** X redirects back with an invalid or missing `state` parameter
- **THEN** the system rejects the callback and displays an error message to the user

### Requirement: System stores Twitter/X account with OAuth 2.0 token
The system MUST call the `/users/me` endpoint to retrieve the authenticated user's Twitter handle and ID, and store a `social_accounts` row with the retrieved profile data and OAuth tokens.

#### Scenario: Successful token exchange and profile fetch
- **WHEN** the token exchange succeeds
- **THEN** the `auth-x-callback` calls `https://api.twitter.com/2/users/me` to fetch `id` and `username`, and stores a `social_accounts` row with `platform = 'twitter'`, the Twitter user ID, handle, access token, and refresh token

#### Scenario: Profile fetch fails after token exchange
- **WHEN** the token exchange succeeds but the `/users/me` call returns an error
- **THEN** the system stores the `social_accounts` row with `platform = 'twitter'` but without profile data, and schedules a background retry

### Requirement: Scopes requested include tweet.read, tweet.write, users.read, offline.access
The system SHALL request the minimum set of scopes required for the Telegram bot to publish tweets on behalf of the user.

#### Scenario: Scope parameter includes all four required scopes
- **WHEN** the system builds the X OAuth authorization URL
- **THEN** the `scope` parameter includes `tweet.read`, `tweet.write`, `users.read`, and `offline.access`

#### Scenario: offline.access scope enables refresh token delivery
- **WHEN** the user completes the OAuth flow with `offline.access` granted
- **THEN** the token endpoint response includes a `refresh_token`

### Requirement: Error handling for X OAuth
The system MUST gracefully handle X OAuth errors.

#### Scenario: User denies permissions on X authorization page
- **WHEN** the X authorization page redirects back with an `error=access_denied` parameter
- **THEN** the system displays "X/Twitter connection was denied. You can try again anytime."

#### Scenario: Token exchange fails
- **WHEN** the `auth-x-callback` receives a 4xx/5xx response from the X token endpoint
- **THEN** the system logs the error, returns a 500 response to the frontend, and does not persist any `social_accounts` row

#### Scenario: PKCE code_verifier mismatch
- **WHEN** the `code_verifier` stored in session does not match the authorization code
- **THEN** the token endpoint responds with an error, and the system displays "The authorization session expired. Please try connecting again."
