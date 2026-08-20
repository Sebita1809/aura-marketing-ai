## ADDED Requirements

### Requirement: The admin panel exposes a Comunicados y Reportes section
The system SHALL add a "Comunicados y Reportes" entry to the administrator sidebar and a corresponding route under the admin area, guarded so that only a profile whose role is `admin` can reach it. A non-admin user who navigates directly to that route SHALL be denied access by the existing route guard.

#### Scenario: The entry is present for an administrator
- **WHEN** an administrator loads the admin panel
- **THEN** the sidebar shows a "Comunicados y Reportes" item that navigates to the support inbox route

#### Scenario: A regular user cannot reach the inbox route
- **WHEN** a non-admin authenticated user navigates directly to the support inbox route
- **THEN** access is denied by the role guard and the inbox is not rendered

#### Scenario: The entry is absent for a regular user
- **WHEN** a non-admin user loads any page of the user area
- **THEN** no "Comunicados y Reportes" item appears in the sidebar

### Requirement: The inbox lists every support conversation
The system SHALL list, for an administrator, all support conversations from all users, ordered by most recent activity first. Each row SHALL show at least the requesting user's identity (company or full name, falling back to a stable identifier), the subject, the category, the status and the time of the last activity, and SHALL mark rows that contain unread user messages.

#### Scenario: Conversations from all users are listed
- **WHEN** an administrator opens the inbox
- **THEN** conversations belonging to every user are listed, most recent activity first

#### Scenario: Unread conversations are distinguishable
- **WHEN** a conversation contains at least one message from a user that the administrator has not read
- **THEN** that row is visually marked as unread and the total count of unread conversations is shown in the section

#### Scenario: Loading and empty states
- **WHEN** the inbox is fetching, fails to fetch, or finds no conversation at all
- **THEN** a loading indicator, an error message with the failure cause, or an explicit empty state is shown respectively

### Requirement: An administrator can filter the inbox by status
The system SHALL let the administrator filter the listed conversations by status — at minimum `open`, `answered`, `closed` and an "all" option — and SHALL apply the filter without losing the ordering by most recent activity.

#### Scenario: Filtering by open
- **WHEN** the administrator selects the `open` filter
- **THEN** only conversations whose status is `open` are listed, still ordered by most recent activity

#### Scenario: Clearing the filter
- **WHEN** the administrator selects the "all" option
- **THEN** every conversation is listed again

#### Scenario: Filter yields nothing
- **WHEN** a selected filter matches no conversation
- **THEN** an empty state states that no conversation matches the filter, distinct from the "no conversations at all" state

### Requirement: An administrator can read a thread and reply from the inbox
The system SHALL let the administrator open any conversation and read its full thread in chronological order, attributing each message to the requesting user or to support, and SHALL let the administrator write a reply from that same view. A submitted reply SHALL appear immediately in the thread, SHALL be stored with `sender_role = 'admin'`, and SHALL move the conversation to `answered`.

Opening a conversation SHALL mark its unread user messages as read.

#### Scenario: Opening a conversation shows the thread
- **WHEN** the administrator selects a conversation from the list
- **THEN** all its messages are shown in chronological order with the sender of each message identified

#### Scenario: Replying updates the thread and the status
- **WHEN** the administrator writes a reply and confirms
- **THEN** the reply is appended to the thread, the conversation status becomes `answered`, and the list reorders it to the top by last activity

#### Scenario: Empty reply is rejected
- **WHEN** the administrator submits an empty or whitespace-only reply
- **THEN** the submission is blocked with an inline validation message and nothing is written

#### Scenario: Reading clears the unread mark
- **WHEN** the administrator opens a conversation that had unread user messages
- **THEN** those messages are marked as read and the unread indicator for that conversation clears

### Requirement: An administrator can close and reopen a conversation
The system SHALL let the administrator set a conversation to `closed` and back to `open` from the inbox, and SHALL reflect the new status in the list and in the thread view without a page reload. A closed conversation SHALL remain readable and SHALL no longer accept new messages until reopened.

#### Scenario: Closing a conversation
- **WHEN** the administrator closes a conversation
- **THEN** its status becomes `closed`, the reply control is disabled, and the row shows the closed status

#### Scenario: Reopening a conversation
- **WHEN** the administrator reopens a closed conversation
- **THEN** its status returns to `open` and replies are accepted again from both sides

### Requirement: New user messages surface in the inbox without a reload
The system SHALL update the administrator inbox when a user submits a new request or a new reply while the inbox is open, adding or reordering the affected conversation and updating the unread indicator, without requiring the administrator to reload the page.

#### Scenario: A new request appears live
- **WHEN** a user submits a new support request while the administrator has the inbox open
- **THEN** the new conversation appears at the top of the list marked as unread, without a reload

#### Scenario: A new reply reorders the list
- **WHEN** a user replies to an existing conversation while the administrator has the inbox open
- **THEN** that conversation moves to the top of the list and is marked as unread
