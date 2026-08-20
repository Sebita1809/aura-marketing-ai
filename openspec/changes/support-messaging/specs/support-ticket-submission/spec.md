## ADDED Requirements

### Requirement: The Soporte entry point exists only for non-admin users
The system SHALL render the "Soporte" navigation item in the sidebar only when the authenticated profile's role is not `admin`. The item SHALL NOT be rendered for an administrator — neither hidden by styling nor pointing to a different destination — and its current placement outside the role branch in `Sidebar.jsx` SHALL be corrected.

#### Scenario: A regular user sees Soporte
- **WHEN** a user whose `profiles.role` is not `admin` loads any page that renders the sidebar
- **THEN** the "Soporte" item is present and actionable

#### Scenario: An administrator does not see Soporte
- **WHEN** a user whose `profiles.role` is `admin` loads the admin panel
- **THEN** no "Soporte" item is rendered anywhere in the sidebar, in the desktop sidebar and in the mobile drawer alike

### Requirement: The Soporte button opens the support surface
The system SHALL make the "Soporte" item open the support surface instead of behaving as a dead link. The current `<Link to="#">` with no handler SHALL be replaced, and activating the item SHALL open the support panel from any page of the user area without navigating away from the current page.

#### Scenario: Clicking Soporte opens the panel
- **WHEN** a user clicks "Soporte" from any page of the user area
- **THEN** the support panel opens over the current page and the current route is preserved

#### Scenario: Closing returns to the same page
- **WHEN** the user closes the support panel
- **THEN** the panel is dismissed and the user remains on the page they came from, with no navigation to `#`

#### Scenario: Soporte works from the mobile drawer
- **WHEN** a user opens the mobile drawer and taps "Soporte"
- **THEN** the drawer closes and the support panel opens

### Requirement: A user can submit a support request
The system SHALL let an authenticated non-admin user create a support request by supplying a subject, a category and a description. On submission the system SHALL create the ticket and its first message atomically from the user's point of view, and SHALL confirm the submission in the interface.

#### Scenario: Valid request is submitted
- **WHEN** the user fills subject, category and description and confirms
- **THEN** the ticket is created with status `open`, the description is stored as its first message, the form is cleared and a success confirmation is shown

#### Scenario: New request appears in the user's history immediately
- **WHEN** the submission succeeds
- **THEN** the new conversation appears at the top of the user's own list of requests without a page reload

#### Scenario: Failure keeps the text
- **WHEN** the submission fails because of a network or database error
- **THEN** an error message is shown, the text the user wrote is preserved in the form, and no partial conversation is left visible

### Requirement: Support requests are validated before submission
The system SHALL reject a submission whose subject or description is empty or whitespace-only, SHALL enforce an upper length bound on both fields, and SHALL require the category to be one of the offered values. The submit control SHALL be disabled while a submission is in flight so that a double click cannot create two tickets.

#### Scenario: Empty description is rejected
- **WHEN** the user submits with an empty or whitespace-only description
- **THEN** the submission is blocked, an inline validation message is shown, and nothing is written to the database

#### Scenario: Over-long input is rejected
- **WHEN** the user submits a subject or description longer than the allowed maximum
- **THEN** the submission is blocked and the limit is communicated in the interface

#### Scenario: Double submit creates one ticket
- **WHEN** the user activates the submit control twice in rapid succession
- **THEN** exactly one ticket is created

### Requirement: A user can read and continue their own conversations
The system SHALL show the authenticated user the list of their own support requests, ordered by most recent activity, each with its subject, status and last-activity time, and SHALL let the user open a conversation to read the full thread in chronological order with each message attributed to the user or to support.

The system SHALL let the user add a reply to a conversation that is not `closed`, and SHALL disable the reply control for a `closed` conversation while still showing its history.

#### Scenario: The history lists the user's own requests
- **WHEN** a user opens the support panel and already has requests
- **THEN** their requests are listed most-recent-activity first with subject, status and last activity, and no request belonging to another user is listed

#### Scenario: Opening a conversation shows the full thread
- **WHEN** the user selects one of their requests
- **THEN** every message of that conversation is shown in chronological order, visually distinguishing messages written by the user from replies written by support

#### Scenario: The user replies in an open thread
- **WHEN** the user writes a reply in a conversation whose status is `open` or `answered` and confirms
- **THEN** the reply is appended to the thread, becomes visible immediately, and the conversation returns to `open`

#### Scenario: A closed conversation is read-only
- **WHEN** the user opens a conversation whose status is `closed`
- **THEN** the history is readable and the reply control is disabled with the reason stated

#### Scenario: Empty state
- **WHEN** a user with no previous requests opens the support panel
- **THEN** an empty state is shown together with the form to create the first request
