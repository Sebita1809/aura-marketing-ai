## 1. Scaffold Vite + React + Tailwind Project

- [x] 1.1 Create Vite project with React template: `npm create vite@latest aura-frontend -- --template react`
- [x] 1.2 Install dependencies: `react-router-dom`, `tailwindcss`, `postcss`, `autoprefixer`, `@tailwindcss/vite`
- [x] 1.3 Configure `tailwind.config.js` with Aura's dark color palette (M3 tokens), font families (Inter, Hanken Grotesk, Geist), and spacing scale extracted from HTML files
- [x] 1.4 Add Google Fonts (Inter, Hanken Grotesk, Geist) and Material Symbols CDN link tags to `index.html`
- [x] 1.5 Write `src/index.css` with global styles: `@tailwind base/components/utilities`, `.glass-card`, `.gradient-btn`, `.primary-gradient`, `.neon-glow-primary`, `.ai-glow`, `.ai-pulse`, `.material-symbols-outlined` base styles
- [x] 1.6 Set up `src/main.jsx` entry point wrapping `<App />` in `<BrowserRouter>` and `<AuthProvider>`

## 2. Shared Components

- [x] 2.1 Create `src/components/GlassCard.jsx` â€” reusable wrapping component with glass-morphism styles and mouse-tracking parallax effect (`--mouse-x`, `--mouse-y` CSS custom properties)
- [x] 2.2 Create `src/components/GradientButton.jsx` â€” primary CTA button with `ddb7ff â†’ 0566d9` gradient, hover brightness, and disabled/loading state
- [x] 2.3 Create `src/components/MaterialIcon.jsx` â€” renders `<span class="material-symbols-outlined">` with consistent base styling
- [x] 2.4 Create `src/components/Navbar.jsx` â€” fixed top nav with Aura brand, anchor links to sections, responsive/mobile collapsed variant (mobile landing merge)
- [x] 2.5 Create `src/components/Sidebar.jsx` â€” fixed left sidebar with Aura branding, nav links (Dashboard, Conexiones, GestiÃ³n de Usuarios, Soporte, Cerrar SesiÃ³n), active item highlight
- [x] 2.6 Create `src/components/ProtectedRoute.jsx` â€” auth gate wrapper that checks `AuthContext.isAuthenticated` and redirects to `/login` if not authenticated
- [x] 2.7 Create `src/components/Footer.jsx` â€” landing page footer with brand info, privacy/terms links, social icons, and copyright
- [x] 2.8 Create `src/context/AuthContext.jsx` â€” React context providing `isAuthenticated`, `user`, `login()`, `logout()` stubs

## 3. Pages

- [x] 3.1 Create `src/pages/LandingPage.jsx` â€” merge of `index.html` and `mobile/index.html` with Navbar, HeroSection, BenefitsSection (3 glass cards), HowItWorksSection (3 step indicators), CTASection (WhatsApp CTA), and Footer; responsive breakpoints at 768px
- [x] 3.2 Create `src/pages/LoginPage.jsx` â€” migrate `login.html` with AmbientGlow (animated pulsing gradient orbs), brand header, centered glass form (email + password with visibility toggle + remember-me checkbox), forgot password link, new user prompt, and footer
- [x] 3.3 Create `src/pages/AdminPanel.jsx` â€” migrate `admin-panel.html` with Sidebar, sticky header (search + "Nuevo Cliente" button + notification/avatar icons), client table with search filtering, status badges (Activo/Inactivo), row hover effect, and inline NewUserModal (opens on "Nuevo Cliente", closes on Escape/close button)
- [x] 3.4 Create `src/pages/RegisterUser.jsx` â€” migrate `register-user.html` with full-page centered glass form (Nombre Completo, Empresa, Correo, ContraseÃ±a Temporal, Telegram ID), role cards (User/Admin) with selection highlight, password visibility toggle, submit loading/success states, Cancel navigation back
- [x] 3.5 Create `src/pages/ConnectionsPage.jsx` â€” migrate `connections.html` with Sidebar (Conexiones active), welcome header with company name, info card, network cards grid (Instagram/X/Facebook/LinkedIn/Telegram Bridge) with connect/revoke buttons, status badges (Conectado/Desconectado), FAB "Nueva Red", inline connect simulation
- [x] 3.6 Create `src/pages/ConnectNetworkPage.jsx` â€” migrate `connect-network.html` with blurred backdrop, centered modal-style glass panel, header (title + subtitle + search), available networks grid (TikTok/YouTube/LinkedIn/Facebook/Pinterest + "Solicitar Red"), LinkedIn recommended badge, OAuth security footer

## 4. Routing Setup

- [x] 4.1 Define all routes in `App.jsx`: `/` â†’ LandingPage, `/login` â†’ LoginPage, `/admin` â†’ AdminPanel, `/admin/register-user` â†’ RegisterUser, `/admin/connections` â†’ ConnectionsPage, `/admin/connect-network` â†’ ConnectNetworkPage
- [x] 4.2 Wrap protected routes (`/admin`, `/admin/register-user`, `/admin/connections`, `/admin/connect-network`) with `<ProtectedRoute>`
- [x] 4.3 Wire login button â†’ navigate to `/login`, sidebar links â†’ SPA navigation, "Cerrar SesiÃ³n" â†’ navigate to `/login`
- [x] 4.4 Add `<Navigate>` redirect from `/login` to `/admin` when `isAuthenticated` is true

## 5. Verification

- [x] 5.1 Run `npm run dev` and confirm all 6 routes render without console errors
- [x] 5.2 Verify landing page: hero, beneficios cards (3), cÃ³mo funciona steps (3), WhatsApp CTA, footer, mobile responsive layout at 768px
- [x] 5.3 Verify login page: ambient glow animation, form fields, password toggle, forgot password link, contact prompt
- [x] 5.4 Verify admin dashboard: sidebar navigation, search filtering, client table with status badges, NewUserModal open/close/Escape behavior
- [x] 5.5 Verify register user: role card selection, form fields, password toggle, submit loading/success states, cancel navigation
- [x] 5.6 Verify connections dashboard: network cards grid with status, connect/revoke buttons, FAB, inline connect simulation
- [x] 5.7 Verify connect network: modal layout, search, network cards, recommended badge, request network card, OAuth footer
- [x] 5.8 Confirm SPA navigation across all routes (no full page reloads), logout redirect to `/login`, login redirect to `/admin` when authenticated

