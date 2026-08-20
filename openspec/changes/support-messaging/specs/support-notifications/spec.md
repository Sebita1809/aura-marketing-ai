## ADDED Requirements

### Requirement: The existing bell icon becomes the notification surface
The system SHALL make the `notifications` bell already present in the user area header actionable, reusing that placement instead of introducing a new visual element. The bell SHALL be extracted into a single shared component used by every user page that renders it, so that `ProfilePage` and `MetricsPage` no longer carry an inert button.

#### Scenario: The bell responds to activation
- **WHEN** a user clicks the bell in the header of a user-area page
- **THEN** the notifications panel opens

#### Scenario: The same component serves every page
- **WHEN** the bell is rendered on more than one user page
- **THEN** all of them use the same shared component and show the same unread count for the same user at the same moment

#### Scenario: The bell is not part of the admin area
- **WHEN** an administrator uses the admin panel
- **THEN** the user notification bell is not the surface used for support activity; unread support activity is reported inside the admin inbox instead

### Requirement: The bell shows the count of unread support replies
The system SHALL display, over the bell, the number of messages written by an administrator inside the authenticated user's own conversations that have not yet been read by that user. When the count is zero the badge SHALL NOT be displayed. The count SHALL never include the user's own messages nor any message from a conversation belonging to another user.

#### Scenario: Unread replies are counted
- **WHEN** the user has two unread administrator replies across their conversations
- **THEN** the bell shows a badge with the value 2

#### Scenario: No badge when nothing is unread
- **WHEN** the user has no unread administrator replies
- **THEN** no badge is rendered over the bell

#### Scenario: Own messages are not counted
- **WHEN** the user sends a support request or a reply
- **THEN** the unread count is unchanged

### Requirement: The notifications panel lists administrator replies
The system SHALL open, on activating the bell, a panel listing the administrator replies addressed to the user, most recent first, each showing the subject of its conversation, an excerpt of the reply and its time, with unread entries visually distinguished from read ones. Selecting an entry SHALL open the corresponding conversation thread.

#### Scenario: Panel lists replies newest first
- **WHEN** the user opens the notifications panel
- **THEN** the administrator replies to their conversations are listed most recent first, with subject, excerpt and time

#### Scenario: Selecting a notification opens the thread
- **WHEN** the user selects an entry in the panel
- **THEN** the support surface opens on the corresponding conversation with the full thread visible

#### Scenario: Empty panel
- **WHEN** the user has never received an administrator reply
- **THEN** the panel shows an explicit empty state

### Requirement: Reading a reply marks it as read
The system SHALL mark an administrator reply as read once the user has opened it — through the notifications panel or by opening its conversation in the support surface — and SHALL decrease the unread badge accordingly without a page reload. A message already read SHALL NOT be marked again.

#### Scenario: Opening a thread clears its unread replies
- **WHEN** the user opens a conversation containing unread administrator replies
- **THEN** those replies are marked as read and the badge decreases by that amount

#### Scenario: Badge disappears at zero
- **WHEN** the last unread reply is read
- **THEN** the badge is no longer rendered

#### Scenario: Read state survives a reload
- **WHEN** the user reloads the page after reading a reply
- **THEN** that reply is still shown as read and is not counted again

### Requirement: Notifications arrive without a page reload, with a degraded fallback
The system SHALL load the initial unread state with a fetch when the surface mounts, and SHALL then subscribe to changes on the support messages so that a new administrator reply updates the badge and the panel while the user stays on the page. If the subscription cannot be established or is dropped, the system SHALL fall back to periodic refresh so that the notification is delayed rather than lost, and SHALL NOT surface a subscription failure as a blocking error.

The subscription SHALL be torn down when the component unmounts, so that navigating between pages does not accumulate channels or deliver duplicate notifications.

#### Scenario: A reply raises the badge live
- **WHEN** an administrator replies to a conversation while the user has a user-area page open
- **THEN** the unread badge increases and the new reply is available in the panel, with no reload and no navigation

#### Scenario: Subscription failure degrades to periodic refresh
- **WHEN** the realtime subscription cannot be established or errors out
- **THEN** the unread state is refreshed periodically instead, the badge still updates, and no blocking error is shown to the user

#### Scenario: Navigating away does not leak subscriptions
- **WHEN** the user navigates repeatedly between user-area pages
- **THEN** each unmount tears down its subscription and a single new reply produces exactly one notification update

#### Scenario: Another user's activity produces no notification
- **WHEN** an administrator replies to a conversation belonging to a different user
- **THEN** the current user's badge, panel and thread views remain unchanged, and no content from that conversation reaches the client
