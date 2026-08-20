## Context

The Aura AI Marketing Automation frontend currently consists of 7 static HTML files under `aura-frontend/` using Tailwind CSS via CDN. Each page duplicates the full Tailwind config (color palette, typography scale, spacing) and shared CSS classes (`.glass-card`, `.gradient-btn`, `.ai-glow`, `.material-symbols-outlined`) inline. Navigation is handled via `window.location.href` — every page transition is a full browser reload.

The backend (n8n workflows + Redis + Telegram bot) remains unchanged — this is a pure front-end migration. The existing HTML pages serve as design specifications: all visual tokens, component patterns, and content must be preserved 1:1 during migration.

**Stakeholders**: Developers maintaining the frontend; end users should experience identical visuals but faster navigation.

## Goals / Non-Goals

**Goals:**
- Scaffold a new Vite + React 18 project inside `aura-frontend/` (or at project root) with npm
- Port all 7 HTML pages (landing, login, admin-panel, register-user, connections, connect-network, mobile/index) into React components
- Implement a shared design system: extract the M3-like dark color palette, font families (Inter, Hanken Grotesk, Geist), spacing scale, and utility classes into a Tailwind CSS config (npm package, not CDN)
- Set up client-side routing with React Router v6
- Keep Material Symbols icons via Google Fonts CDN link (no npm icon package)
- Use React state/context for auth state (no third-party state management)
- Provide SPA navigation: sidebar links, login redirect, modal flow for user registration

**Non-Goals:**
- Backend changes (n8n, Redis, Telegram bot untouched)
- Actual authentication logic (forms remain UI-only, same as current HTML)
- Test setup (can be added in a future change)
- Server-side rendering or static export (pure client-side SPA)
- Responsive breakpoints beyond what the HTML already defines

## Decisions

### 1. Project Setup: Vite + React 18 + Tailwind v3 (npm)

**Rationale**: Vite is the recommended build tool for React 18 with near-instant HMR, native ES module dev server, and first-class Tailwind CSS support via `@tailwindcss/vite` plugin. The CDN-based Tailwind used currently is unsuitable for production (missing purge, JIT compilation only at runtime). Moving Tailwind to an npm package enables proper `tailwind.config.js`, class-based purge, and full IntelliSense support.

**Alternatives considered**:
- Create React App (CRA) — deprecated, slower builds, no native Tailwind integration
- Next.js — overkill for a 7-page SPA with no SSR requirement; would add unnecessary complexity
- Remix — same reasoning as Next.js

### 2. Routing: React Router v6 (flat routes, no layouts yet)

**Rationale**: The SPA has exactly 6 top-level page destinations with no nested route requirements (landing is public, the rest are internal). React Router v6's flat route config with `<BrowserRouter>` is the simplest approach. A `PrivateRoute` wrapper component can gate authenticated pages via React Context.

**Route map**:
| Route | Component | Protected | Notes |
|---|---|---|---|
| `/` | `LandingPage` | No | Merges desktop landing + mobile landing |
| `/login` | `LoginPage` | No | |
| `/admin` | `AdminPanel` | Yes | Dashboard; "Nuevo Cliente" opens modal |
| `/admin/register` | `RegisterUser` | Yes | Could be a route or modal — keep as modal matching HTML |
| `/connections` | `ConnectionsPage` | Yes | Connections dashboard |
| `/connections/new` | `ConnectNetworkPage` | Yes | "Conectar Nueva Red" |

**Alternatives considered**:
- Single-page with hash routing — BrowserRouter is cleaner and standard for React SPAs
- File-based routing (Next.js, Vite plugin) — unnecessary abstraction for a known, small route set

### 3. Auth State: React Context (`AuthContext`)

**Rationale**: Current HTML uses hardcoded redirects (`onclick="location.href='admin-panel.html'"`) with no real auth. Since auth is a non-goal, a minimal context that provides an `isAuthenticated` boolean and a `login()` / `logout()` stub is sufficient. This gates protected routes and feeds the sidebar user display.

### 4. Sharing Design Tokens: Custom Tailwind Config + Utility Classes

**Rationale**: All 7 HTML files define an identical color palette (60+ M3 tokens), font family aliases, spacing scale, and font sizes. These must be extracted once into `tailwind.config.js`. The following present in every file are good candidates for shared CSS:
- `.glass-card` — the frosted-glass card pattern
- `.gradient-btn` / `.primary-gradient` — the `ddb7ff → 0566d9` gradient button
- `.neon-glow-primary` / `.ai-glow` — the `rgba(221, 183, 255, 0.2)` glow shadow
- `.ai-pulse` — the pulsing animation for active indicators
- `.material-symbols-outlined` base style — `font-variation-settings`

These go into `src/index.css` using `@layer components` or as regular CSS classes.

### 5. Component Architecture

**Component tree**:
```
App
├── AuthProvider (Context)
├── Routes
│   ├── LandingPage
│   │   ├── Navbar
│   │   ├── HeroSection
│   │   ├── BenefitsSection
│   │   ├── HowItWorksSection
│   │   ├── CTASection
│   │   └── Footer
│   ├── LoginPage
│   │   ├── AmbientGlow (background effect)
│   │   └── LoginForm
│   ├── AdminPanel (ProtectedRoute)
│   │   ├── Sidebar
│   │   ├── AdminHeader
│   │   ├── ClientsTable
│   │   └── NewUserModal
│   ├── RegisterUser (or modal inside AdminPanel)
│   ├── ConnectionsPage (ProtectedRoute)
│   │   ├── Sidebar
│   │   ├── PageHeader
│   │   ├── ConnectionCard (×5)
│   │   └── TelegramBridgeCard
│   └── ConnectNetworkPage (ProtectedRoute)
│       ├── SearchBar
│       └── NetworkCard (×6)
```

**Shared components** (created in `src/components/`):
- `GlassCard` — wrapper with glass-card styles
- `GradientButton` — primary gradient CTA button
- `Sidebar` — shared admin sidebar with nav links
- `ProtectedRoute` — auth gate wrapper
- `MaterialIcon` — renders `<span class="material-symbols-outlined">` with consistent base styles

### 6. Assets & Dependencies

**npm dependencies**:
| Package | Version | Purpose |
|---|---|---|
| `react` | ^18 | UI library |
| `react-dom` | ^18 | DOM renderer |
| `react-router-dom` | ^6 | Client-side routing |
| `tailwindcss` | ^3 | Utility-first CSS |
| `@tailwindcss/vite` | ^4 | Vite plugin for Tailwind |

**External (linked via CDN in `index.html`)**:
- Google Fonts: Inter, Hanken Grotesk, Geist
- Material Symbols (`Material+Symbols+Outlined`)

No icon npm package is installed — Material Symbols are kept as a font CDN link to match the current approach and avoid bundle bloat.

## Risks / Trade-offs

- **[Design drift] →** Any mismatch between HTML visuals and React output will be noticeable. Mitigation: extract Tailwind config and CSS classes exactly from the HTML source; visually diff each page after migration before moving to the next.
- **[No testing] →** Without tests, regressions are caught manually. Mitigation: this is an accepted non-goal per the proposal; manual verification is sufficient for the current project stage.
- **[CDN dependency for fonts/icons] →** If the CDN is unreachable, icons and custom fonts fail. Mitigation: acceptable for this scope — the HTML already depends on the same CDNs. A future change could self-host fonts.
- **[All-in-one SPA vs incremental] →** Migrating all 7 pages at once is higher risk than one-by-one. Mitigation: the pages are strongly interdependent via navigation links; a partial migration would leave broken links. The full switch is cleaner.
- **[Tailwind v3 vs v4] →** Tailwind v4 is newer but less battle-tested with React. Mitigation: stick with v3 (the version the HTML uses via CDN) for consistency and ecosystem stability.

## Migration Plan

### Phase 1: Scaffold (≈30 min)
1. `npm create vite@latest aura-frontend -- --template react`
2. Install dependencies: `react-router-dom`, `tailwindcss`, `@tailwindcss/vite`
3. Configure `tailwind.config.js` — extract colors, fonts, spacing from HTML files
4. Add Google Fonts and Material Symbols link tags to `index.html`
5. Write `src/index.css` with the global styles (glass-card, gradient, animations)
6. Set up `src/main.jsx` with `<BrowserRouter>` and `<AuthProvider>`

### Phase 2: Shared Components (≈1 hour)
1. Create `src/components/GlassCard.jsx`
2. Create `src/components/GradientButton.jsx`
3. Create `src/components/MaterialIcon.jsx`
4. Create `src/components/Sidebar.jsx` (shared between admin, connections)
5. Create `src/components/Navbar.jsx` (shared between landing pages)
6. Create `src/components/ProtectedRoute.jsx`
7. Create `src/components/Footer.jsx`
8. Create `src/context/AuthContext.jsx`

### Phase 3: Pages (≈2-3 hours)
1. **LandingPage**: Navbar + Hero + Benefits + HowItWorks + CTA + Footer (from `index.html` + `mobile/index.html`)
2. **LoginPage**: AmbientGlow + Aura header + login form + footer links
3. **AdminPanel**: Sidebar + header + clients table + NewUserModal (inline)
4. **ConnectionsPage**: Sidebar + header + connection cards + Telegram bridge + FAB
5. **ConnectNetworkPage**: Search bar + network cards grid + OAuth footer

### Phase 4: Routing & Wiring (≈30 min)
1. Define all routes in `App.jsx`
2. Wrap protected routes with `<ProtectedRoute>`
3. Wire up login button → `/` redirect, sidebar links, logout redirect
4. Add `Navigate` from login to `/admin` when `isAuthenticated` is true

### Phase 5: Verification (≈30 min)
1. `npm run dev` — verify all pages render with correct styles
2. Confirm SPA navigation (no full reloads)
3. Compare glass-card hover effects, gradient buttons, icon rendering against HTML originals
4. Test mobile viewport for landing page

**Total estimate**: ≈5 hours

### Rollback Strategy
The old `aura-frontend/*.html` files remain untouched in the repo. If the React build has a blocking issue, the existing HTML files can be served directly by any static file server or n8n — zero backend changes needed.

## Open Questions

- Should the `RegisterUser` page remain a modal (as in the current HTML) or become its own route? The modal approach matches the HTML behavior and feels more natural for an admin panel; route `/admin/users/new` could render the same content.
- Should the landing page be built as a single component or sectioned into sub-components? Section-based is cleaner and matches the HTML structure (HeroSection, BenefitsSection, etc.).
- Where should the React project live — inside `aura-frontend/` (replacing the HTML files) or in a new directory like `aura-frontend/react/`? Keeping it as the new `aura-frontend/` is simpler; the old HTML can be moved to `aura-frontend/legacy-html/` for reference.
- Should Material Symbols be installed via npm (`material-symbols`) or kept as CDN? Keeping CDN matches current behavior and avoids bundle bloat; npm install would add ~200KB+ but eliminate the external dependency.
