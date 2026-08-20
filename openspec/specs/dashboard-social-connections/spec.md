## ADDED Requirements

### Requirement: ConnectionsPage shows Meta/Instagram as a visual group containing Instagram, Facebook, and Threads
The ConnectionsPage SHALL render a grouped card titled "Meta / Instagram" that expands to show the three sub-platforms: Instagram, Facebook Pages, and Threads.

#### Scenario: User with only Instagram connected sees grouped card with one active platform
- **WHEN** the user has a single `social_accounts` row with `platform = 'instagram'`
- **THEN** the "Meta / Instagram" group card displays Instagram as connected and Facebook and Threads as "Not connected" with a "Connect" action

#### Scenario: User with all three Meta platforms connected sees full group
- **WHEN** the user has `social_accounts` rows for `instagram`, `facebook`, and `threads`
- **THEN** the "Meta / Instagram" group card shows all three platforms as connected with their respective profile details (avatar, handle, platform icon)

#### Scenario: No Meta platforms connected
- **WHEN** the user has no `social_accounts` rows with a Meta platform type
- **THEN** the "Meta / Instagram" group card shows a single "Connect Meta" button without expanding sub-platform details

### Requirement: X appears as a separate individual block
X/Twitter SHALL be rendered outside the Meta group, as its own standalone card.

#### Scenario: X/Twitter connected
- **WHEN** the user has a `social_accounts` row with `platform = 'twitter'`
- **THEN** a standalone "X / Twitter" card shows the connected account handle, avatar, and connection status

#### Scenario: X/Twitter not connected
- **WHEN** the user has no `social_accounts` row with `platform = 'twitter'`
- **THEN** a standalone "X / Twitter" card shows a "Connect X" button

### Requirement: Each platform shows connection status (connected/disconnected/expired)
Every platform card or sub-item SHALL display a visual status indicator reflecting the current state of the connection.

#### Scenario: Connected platform shows green indicator
- **WHEN** a `social_accounts` row has `is_connected = true` and `token_expires_at > NOW()`
- **THEN** the platform displays a green "Connected" badge

#### Scenario: Disconnected platform shows gray indicator
- **WHEN** a `social_accounts` row has `is_connected = false`
- **THEN** the platform displays a gray "Disconnected" badge with a "Reconnect" button

#### Scenario: Expired platform shows yellow or red indicator
- **WHEN** a `social_accounts` row has `is_connected = true` but `token_expires_at < NOW()`
- **THEN** the platform displays a red "Expired" badge with a "Reconnect" button

### Requirement: User can revoke access per-platform
Each connected platform SHALL provide a "Revoke access" action that removes the token and marks the account as disconnected.

#### Scenario: User revokes Instagram within Meta group
- **WHEN** the user clicks "Revoke access" on Instagram inside the Meta group
- **THEN** the system calls the `auth-meta-callback` or a dedicated revoke endpoint to invalidate the token on Meta's side, then deletes or nullifies the `social_accounts` row, and updates the UI

#### Scenario: User revokes X/Twitter
- **WHEN** the user clicks "Revoke access" on the X/Twitter card
- **THEN** the system calls `https://api.twitter.com/2/oauth2/revoke` to invalidate the token, then deletes or nullifies the `social_accounts` row, and updates the UI

#### Scenario: Revocation confirmation dialog
- **WHEN** the user clicks "Revoke access" on any platform
- **THEN** a confirmation dialog appears: "Are you sure you want to revoke [platform] access? Campaigns scheduled for this platform will not be published."
