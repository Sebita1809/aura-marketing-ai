## ADDED Requirements

### Requirement: The admin dashboard lives on the `/admin` protected route
The system SHALL serve the admin metrics dashboard at `/admin`, rendered by `AdminDashboard.jsx` and wrapped in `<ProtectedRoute requiredRole="admin">`. This resolves OQ1 of `design.md`: the sibling change `admin-user-management` (archived 2026-08-18) already moved the clients table to `/admin/users` and left `/admin` as a provisional redirect to `/admin/users`, explicitly anticipating that this change would claim `/admin` (its own `design.md` D6: "el change hermano es dueño del elemento de la ruta `/admin`"). This change replaces that provisional redirect with `AdminDashboard.jsx`. No separate `/admin/dashboard` route is created. `/admin/users` and `AdminPanel.jsx`/`UsersPage.jsx` are not modified by this change. The admin sidebar's pre-existing entry labelled "Dashboard" (added by `admin-user-management`, already pointing to `/admin`) requires no relabelling — there is no second "Dashboard"-like entry to disambiguate.

#### Scenario: Admin reaches the dashboard
- **WHEN** a signed-in user with `role = 'admin'` navigates to `/admin`
- **THEN** the metrics dashboard renders

#### Scenario: Non-admin is blocked
- **WHEN** a signed-in user without the admin role navigates to `/admin`
- **THEN** access is denied by the same `ProtectedRoute` mechanism that guards the other `/admin` routes, and no metrics request is issued

#### Scenario: The user management page is untouched
- **WHEN** an admin navigates to `/admin/users`
- **THEN** the existing user management page (`UsersPage.jsx`) renders exactly as before this change, under the sidebar label "Gestión de Usuarios"

### Requirement: The dashboard shows the four requested KPIs
The dashboard SHALL display four KPI cards: number of clients (total, with active clients as a sub-value), estimated Google AI spend in USD, number of published posts, and number of generated images with a "new / redone" sub-breakdown. Every KPI value SHALL come from the single `admin_dashboard_metrics` RPC call; the page SHALL NOT compute aggregates from raw rows in the browser.

#### Scenario: KPIs render from one request
- **WHEN** an admin opens the dashboard
- **THEN** exactly one `admin_dashboard_metrics` RPC call is made and the four cards are populated from its response

#### Scenario: Image KPI exposes redone images
- **WHEN** the period contains both newly generated and edited/regenerated images
- **THEN** the image card shows the combined total as its headline number and "N nuevas · M rehechas" as its sub-value

#### Scenario: Client KPI works without any usage data
- **WHEN** `usage_events` is empty
- **THEN** the client KPI still shows the real counts read from `profiles`

### Requirement: The estimated cost is presented as an estimate, never as billing
The Google AI cost card SHALL be titled as an estimate and SHALL carry a visible note stating that it is computed from invocation and token counts against list prices, and is not Google Cloud billing data. The dashboard SHALL provide a per-model breakdown of that estimate, and SHALL visually flag models that have no configured price.

#### Scenario: Cost card is labelled
- **WHEN** the cost KPI renders with any value
- **THEN** the card text identifies the figure as an estimate and links or points to the per-model breakdown

#### Scenario: Unpriced model is surfaced
- **WHEN** the breakdown contains a model with no price configured
- **THEN** that row is displayed with an explicit "sin precio configurado" marker rather than silently showing `$0`

### Requirement: The dashboard supports a configurable period
The dashboard SHALL offer period selection of 7, 30 and 90 days plus "todo", defaulting to 30 days, and SHALL re-query the RPC with the corresponding boundaries when the selection changes. Usage KPIs, the cost breakdown and the daily series SHALL reflect the selected period; the client KPI SHALL remain period-independent.

#### Scenario: Switching period refreshes usage metrics
- **WHEN** the admin switches from 30 days to 7 days
- **THEN** a new RPC call is issued with the narrower window and the cost, posts, images, breakdown and series update

#### Scenario: Client count is unaffected by the period
- **WHEN** the admin switches periods
- **THEN** the client KPI shows the same totals in every selection

### Requirement: The dashboard renders load, error and no-data states distinctly
The dashboard SHALL show a loading state while the RPC is in flight, an error state with a retry affordance when it fails, and a distinct "sin datos aún" state when the call succeeds but no usage events exist in the selected period. The no-data state SHALL explain that usage tracking depends on the bot instrumentation and SHALL NOT be rendered as a `$0` / `0` success state for the cost KPI.

#### Scenario: Metrics still uninstrumented
- **WHEN** the RPC succeeds and reports no events at all
- **THEN** the usage KPIs display the "sin datos aún" state with the explanation about pending bot instrumentation, while the client KPI shows real numbers

#### Scenario: RPC fails
- **WHEN** the RPC call returns an error (including an authorization error)
- **THEN** the page shows an error state with a retry action and no stale or fabricated values

#### Scenario: Loading state
- **WHEN** the RPC call is in flight
- **THEN** the page shows a loading indicator instead of empty or zeroed cards

### Requirement: The dashboard discloses the data coverage window
The dashboard SHALL display the timestamp of the first recorded usage event ("datos desde …") and of the most recent one ("último evento …"), so that missing history and a stalled producer are both visible without external monitoring.

#### Scenario: Coverage is shown once data exists
- **WHEN** usage events exist
- **THEN** the dashboard shows the first-event date and the last-event date

#### Scenario: Stalled instrumentation is visible
- **WHEN** the most recent event is older than the selected period
- **THEN** the last-event indicator makes that staleness apparent instead of the dashboard implying zero activity

### Requirement: The dashboard reuses the existing design system and adds no new dependency
The dashboard SHALL be built from the existing `GlassCard`, `MaterialIcon` and `GradientButton` components and the project's Tailwind theme tokens, and SHALL render the daily series with inline SVG or CSS bars. The change SHALL NOT add any new runtime dependency to `aura-frontend/package.json`.

#### Scenario: No charting library is introduced
- **WHEN** the change is implemented
- **THEN** `package.json` dependencies are unchanged and the daily series is drawn without a third-party chart library

#### Scenario: Visual consistency with the rest of the panel
- **WHEN** an admin moves between `/admin` and `/admin/users`
- **THEN** both pages share the same sidebar, header pattern, card styling and theme tokens
