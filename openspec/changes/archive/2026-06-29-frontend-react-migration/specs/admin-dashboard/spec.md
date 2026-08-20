# Spec: Admin Dashboard

## Overview

Protected admin dashboard at the `/admin` route. Displays a client management table with sidebar navigation and a search bar. Migrated from `admin-panel.html`.

## ADDED Requirements

### Requirement: Sidebar navigation
The admin dashboard SHALL render a fixed left sidebar with navigation links and branding.

#### Scenario: Sidebar renders with nav items
- **WHEN** the user navigates to `/admin`
- **THEN** a sidebar SHALL display with "Aura" branding, "Modo Administrador" subtitle, and navigation links: "Dashboard", "Conexiones", "Gestión de Usuarios", "Soporte", and "Cerrar Sesión"

#### Scenario: Active nav item is highlighted
- **WHEN** the user is on the "Gestión de Usuarios" section
- **THEN** the corresponding nav item SHALL have a purple background and bold text

#### Scenario: Sidebar navigation works
- **WHEN** the user clicks "Conexiones" in the sidebar
- **THEN** the app SHALL navigate to the connections page

#### Scenario: Logout navigates to login
- **WHEN** the user clicks "Cerrar Sesión"
- **THEN** the app SHALL navigate to `/login`

### Requirement: Top header bar with search and actions
The admin dashboard SHALL render a sticky top header with page title, search input, and action buttons.

#### Scenario: Header renders correctly
- **WHEN** the admin dashboard loads
- **THEN** a sticky header SHALL display with the title "Clientes", a search input with search icon, a "Nuevo Cliente" gradient button, a notification icon, and a user avatar icon

#### Scenario: Search input filters table
- **WHEN** the user types in the search input
- **THEN** the client table SHALL filter rows whose company name or email matches the search query

### Requirement: Client table
The admin dashboard SHALL render a data table listing clients with their details and status indicators.

#### Scenario: Table renders with correct columns
- **WHEN** the admin dashboard loads
- **THEN** a table SHALL display with columns: ID, Nombre de la Empresa, Correo Electrónico, Telegram Chat ID, Estado, Acciones

#### Scenario: Client rows render with status badges
- **WHEN** the client data loads
- **THEN** each row SHALL display a status badge: green with "Activo" for active clients, or gray with "Inactivo" for inactive clients

#### Scenario: Row hover effect
- **WHEN** the user hovers over a table row
- **THEN** the row background SHALL change to a subtle white overlay

### Requirement: New client modal
The admin dashboard SHALL include a modal for creating new clients.

#### Scenario: Modal opens on button click
- **WHEN** the user clicks "Nuevo Cliente"
- **THEN** a modal overlay SHALL open with a glass card form titled "Crear Usuario" with fields: Nombre de Empresa, Email, Contraseña temporal, Telegram Chat ID, and a "Crear Usuario" submit button

#### Scenario: Modal closes on close button
- **WHEN** the user clicks the close button inside the modal
- **THEN** the modal SHALL fade out and close

#### Scenario: Modal closes on Escape key
- **WHEN** the modal is open and the user presses the Escape key
- **THEN** the modal SHALL close
