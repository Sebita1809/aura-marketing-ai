## ADDED Requirements

### Requirement: Support conversations are persisted as tickets and messages
The system SHALL persist every support conversation as one `support_tickets` row plus one `support_messages` row per turn of the conversation.

`support_tickets` SHALL carry: `id` (uuid, primary key), `user_id` (uuid, FK to `public.profiles(id)` `ON DELETE CASCADE`, the owner of the conversation), `subject` (text, not null), `category` (text, not null, constrained by CHECK), `status` (text, not null, constrained by CHECK), `created_at`, `updated_at` and `last_message_at` (timestamptz, not null).

`support_messages` SHALL carry: `id` (uuid, primary key), `ticket_id` (uuid, FK to `public.support_tickets(id)` `ON DELETE CASCADE`), `sender_id` (uuid, FK to `public.profiles(id)`), `sender_role` (text, not null, `CHECK (sender_role IN ('user','admin'))`), `body` (text, not null), `read_at` (timestamptz, nullable) and `created_at` (timestamptz, not null).

The initial description written by the user when opening a ticket SHALL be stored as the first `support_messages` row of that ticket with `sender_role = 'user'`, and SHALL NOT be duplicated into a column of `support_tickets`.

#### Scenario: Opening a ticket creates one ticket and one message
- **WHEN** a user submits a new support request with subject, category and description
- **THEN** exactly one `support_tickets` row is created with that subject and category, and exactly one `support_messages` row is created for it with `sender_role = 'user'`, `sender_id` equal to the author, and the description as `body`

#### Scenario: A reply adds a message, never a ticket
- **WHEN** either the user or an administrator replies inside an existing conversation
- **THEN** a new `support_messages` row is inserted against the same `ticket_id` and no new `support_tickets` row is created

#### Scenario: Deleting a ticket removes its thread
- **WHEN** a `support_tickets` row is deleted
- **THEN** all `support_messages` rows referencing it are removed by the `ON DELETE CASCADE` constraint

### Requirement: Ticket status follows a defined lifecycle
The system SHALL constrain `support_tickets.status` to `open`, `answered` or `closed` via a CHECK constraint, and SHALL maintain it as follows: a ticket is created with `status = 'open'`; it becomes `answered` when a message with `sender_role = 'admin'` is inserted; it returns to `open` when a message with `sender_role = 'user'` is inserted into a ticket whose status is `answered`; it becomes `closed` only by an explicit administrator action.

Status transitions and `last_message_at` SHALL be maintained by a database trigger on insert into `support_messages`, and SHALL NOT depend on the client sending an update.

#### Scenario: Admin reply marks the ticket answered
- **WHEN** an administrator inserts a message into an `open` ticket
- **THEN** the ticket status becomes `answered` and `last_message_at` is set to the message timestamp, without the client issuing any update

#### Scenario: User reply reopens an answered ticket
- **WHEN** the owner inserts a message into a ticket whose status is `answered`
- **THEN** the ticket status returns to `open` and `last_message_at` is updated

#### Scenario: Invalid status is rejected
- **WHEN** any writer attempts to set `status` to a value outside `open`, `answered`, `closed`
- **THEN** the CHECK constraint rejects the write

### Requirement: A user can only reach their own support data
The system SHALL enable Row Level Security on `support_tickets` and `support_messages`, and SHALL restrict a non-admin authenticated user to rows belonging to a ticket whose `user_id` equals `auth.uid()`, for read and for write. No policy SHALL be granted to the `anon` role.

#### Scenario: User reads only their own tickets
- **WHEN** an authenticated non-admin user selects from `support_tickets`
- **THEN** only rows whose `user_id` equals their own id are returned, regardless of any filter the client sends

#### Scenario: User cannot read another user's thread
- **WHEN** an authenticated non-admin user selects from `support_messages` filtering by a `ticket_id` belonging to a different user
- **THEN** zero rows are returned

#### Scenario: User cannot write into another user's thread
- **WHEN** an authenticated non-admin user attempts to insert a message with a `ticket_id` owned by a different user
- **THEN** the insert is rejected by the row level security policy

#### Scenario: Anonymous access is denied
- **WHEN** an unauthenticated (anon) client queries `support_tickets` or `support_messages`
- **THEN** no rows are returned and no write succeeds

### Requirement: Only an administrator can act as support
The system SHALL determine administrator status through a `STABLE SECURITY DEFINER` function `public.is_admin()` that resolves `profiles.role = 'admin'` for `auth.uid()` with `SET search_path = public`, and SHALL use that function inside the policies instead of an inline subquery over `profiles`.

The insert policies SHALL bind `sender_role` to the writer's actual role: a non-admin user SHALL only insert messages with `sender_role = 'user'`, and only an administrator SHALL insert messages with `sender_role = 'admin'`. In both cases `sender_id` SHALL equal `auth.uid()`.

#### Scenario: Admin sees every ticket
- **WHEN** an authenticated user whose `profiles.role` is `admin` selects from `support_tickets`
- **THEN** tickets from all users are returned

#### Scenario: User cannot forge a support reply
- **WHEN** a non-admin user attempts to insert a message with `sender_role = 'admin'` into their own ticket
- **THEN** the insert is rejected by the policy and no message is stored

#### Scenario: User cannot forge another sender
- **WHEN** any writer attempts to insert a message whose `sender_id` differs from `auth.uid()`
- **THEN** the insert is rejected by the policy

#### Scenario: Only an admin changes ticket status
- **WHEN** a non-admin user attempts to update `status` on any ticket, including their own
- **THEN** the update is rejected by the policy

### Requirement: Closed tickets accept no new messages
The system SHALL reject inserts of new messages into a ticket whose `status` is `closed`, enforced in the database rather than only in the user interface.

#### Scenario: Reply to a closed ticket is rejected
- **WHEN** a user attempts to insert a message into a ticket whose status is `closed`
- **THEN** the insert is rejected and the thread remains unchanged

#### Scenario: Reopening requires an administrator
- **WHEN** an administrator updates a `closed` ticket back to `open`
- **THEN** the update succeeds and subsequent messages are accepted again

### Requirement: The read flag is the only field a reader may update
The system SHALL allow an authenticated reader to update only the `read_at` column of messages addressed to them — a non-admin user on messages with `sender_role = 'admin'` inside their own tickets, an administrator on messages with `sender_role = 'user'` — and SHALL reject any update that modifies `body`, `sender_role`, `sender_id`, `ticket_id` or `created_at`. Deletion of tickets and messages SHALL NOT be exposed to any client role.

#### Scenario: Marking a reply as read succeeds
- **WHEN** the owner of a ticket sets `read_at` on an admin message inside that ticket
- **THEN** the update succeeds and only `read_at` changes

#### Scenario: Editing the body of a message is rejected
- **WHEN** any client attempts to update the `body` of an existing message
- **THEN** the update is rejected by the guard trigger and the stored body is unchanged

#### Scenario: Deleting a message is rejected
- **WHEN** any authenticated client attempts to delete a row from `support_messages` or `support_tickets`
- **THEN** the delete is rejected because no delete policy exists

### Requirement: The change is delivered as an additive Supabase migration with no new Edge Function
The system SHALL introduce the support schema through a single new migration file under `aura-frontend/supabase/migrations/`, ordered after the existing migrations, that creates the tables, their indexes (at minimum on `support_tickets.user_id`, `support_tickets.last_message_at` and `support_messages.ticket_id`), the `is_admin()` helper, the row level security policies, the triggers, and the realtime publication entries. The migration SHALL NOT alter or drop any existing table, and the feature SHALL NOT require a new Supabase Edge Function.

#### Scenario: Migration is additive
- **WHEN** the new migration is applied to the project
- **THEN** the support tables and policies are created and no pre-existing table, column, policy or function is modified or dropped

#### Scenario: Row level security is enabled before publication
- **WHEN** the migration reaches the statement that adds the tables to the `supabase_realtime` publication
- **THEN** row level security is already enabled with its policies in place on both tables

#### Scenario: No Edge Function is introduced
- **WHEN** the change is complete
- **THEN** `aura-frontend/supabase/functions/` still contains only `auth-meta-callback`, `auth-x-callback`, `create-user` and `token-manager`, all unmodified
