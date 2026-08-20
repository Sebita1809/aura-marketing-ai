## ADDED Requirements

### Requirement: User initiates Meta OAuth from ConnectNetworkPage
The system SHALL redirect the user to Facebook Login for Business when they click "Connect Meta" on the ConnectNetworkPage.

#### Scenario: User clicks Connect Meta on ConnectNetworkPage
- **WHEN** the user clicks "Connect Meta" button
- **THEN** the system redirects to `https://facebook.com/dialog/oauth` with `client_id`, `redirect_uri`, `state`, and the required scopes

#### Scenario: OAuth redirect with valid state parameter
- **WHEN** the user authorizes the app and Facebook redirects back with a valid `state` matching the stored CSRF token
- **THEN** the system exchanges the `code` for an access token via the `auth-meta-callback` Edge Function

#### Scenario: OAuth redirect with invalid state parameter
- **WHEN** the user authorizes the app and Facebook redirects back with an invalid or missing `state` parameter
- **THEN** the system rejects the callback and shows an error message

### Requirement: System differentiates between Instagram, Facebook Pages, and Threads accounts after login
The system MUST inspect the granted scopes and token metadata to classify the connected account as one of: Instagram, Facebook Page, or Threads.

#### Scenario: Successful token fetch for Instagram
- **WHEN** the `auth-meta-callback` receives a token with scopes containing `instagram_basic` and `instagram_content_publish`
- **THEN** the system stores a `social_accounts` row with `platform = 'instagram'` and the received token

#### Scenario: Successful token fetch for Facebook Page
- **WHEN** the `auth-meta-callback` receives a token with scopes containing `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts`
- **THEN** the system stores a `social_accounts` row with `platform = 'facebook'` and the received token

#### Scenario: Successful token fetch for Threads
- **WHEN** the `auth-meta-callback` receives a token with scopes containing `threads_basic` and `threads_content_publish`
- **THEN** the system stores a `social_accounts` row with `platform = 'threads'` and the received token

### Requirement: System stores separate social_accounts rows per platform with correct tokens
Each Meta sub-platform (Instagram, Facebook, Threads) SHALL have its own `social_accounts` row with the platform-specific access token, refresh token, and expiration metadata.

#### Scenario: User connects both Instagram and Facebook Page in one session
- **WHEN** the user authorizes the app with scopes covering both Instagram and Facebook Pages
- **THEN** the system creates two `social_accounts` rows — one with `platform = 'instagram'` and one with `platform = 'facebook'` — each with their respective token metadata

#### Scenario: Duplicate connection detection
- **WHEN** a user connects a platform they have already connected
- **THEN** the system updates the existing `social_accounts` row instead of creating a duplicate

### Requirement: Scopes requested include the full Meta Business set
The OAuth request MUST include scope values: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `threads_basic`, `threads_content_publish`.

#### Scenario: Full scope set sent to Facebook Login
- **WHEN** the system builds the Facebook Login URL
- **THEN** the `scope` parameter includes all seven required scopes

#### Scenario: User grants fewer scopes than requested
- **WHEN** the callback receives a token with fewer scopes than requested (user denied some permissions)
- **THEN** the system stores only the platforms corresponding to the granted scopes and informs the user which platforms were omitted

### Requirement: Error handling for Meta OAuth
The system MUST gracefully handle OAuth errors from the authorization server.

#### Scenario: User denies permissions on Facebook Login
- **WHEN** Facebook redirects to the callback with an `error=access_denied` parameter
- **THEN** the system displays a message "You denied the connection request. Please try again if you change your mind."

#### Scenario: Token exchange fails
- **WHEN** the `auth-meta-callback` receives a 4xx/5xx response from Facebook's token endpoint
- **THEN** the system logs the error, does not create any `social_accounts` row, and returns a 500 response to the frontend with an appropriate error message

#### Scenario: Network timeout during token exchange
- **WHEN** the Facebook token endpoint does not respond within 15 seconds
- **THEN** the system retries once, and if it fails again returns a user-friendly error
