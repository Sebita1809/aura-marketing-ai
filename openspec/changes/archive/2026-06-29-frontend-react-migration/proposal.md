# Proposal: Frontend React Migration

## What
Migrate the Aura AI Marketing frontend from static HTML (Tailwind CDN) to a React application with proper tooling, routing, and component architecture.

## Why
- **Maintainability**: Static HTML files are hard to maintain, reuse, and scale
- **User Experience**: React enables SPA navigation without full page reloads
- **State Management**: Better handling of auth state, form state, and UI interactions
- **Tooling**: Modern build pipeline with Vite, proper package management, and HMR
- **Code Organization**: Component-based architecture for better separation of concerns

## Scope

### Pages to Migrate (7 HTML → React Pages)
1. **Landing** (`index.html`) → Landing/Home page
2. **Login** (`login.html`) → Login page
3. **Register User** (`register-user.html`) → Register User modal/page
4. **Admin Panel** (`admin-panel.html`) → Admin Dashboard page
5. **Connections** (`connections.html`) → Connections Dashboard page
6. **Connect Network** (`connect-network.html`) → Connect Network page
7. **Mobile Landing** (`mobile/index.html`) → Mobile-responsive landing (merged into Landing)

### Tech Stack
- **Vite** (build tool) + React 18
- **Tailwind CSS v3** (npm package, not CDN)
- **React Router v6** (SPA routing)
- **Material Symbols** (Google Icons, kept via CDN link or npm)
- Same Google Fonts (Inter, Hanken Grotesk, Geist)

### Non-Goals
- No backend changes (n8n + Redis stay untouched)
- No actual authentication logic (forms remain UI-only for now)
- No state management library (React state/context is sufficient)
- No testing setup (can be added later)

## Timeline
1. Scaffold Vite + React + Tailwind project
2. Create shared components (layout, glass card, buttons, nav)
3. Create pages from HTML templates
4. Set up routing
5. Verify all pages render correctly
