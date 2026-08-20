# Spec: Connect Network

## Overview

Network selection page at the `/admin/connect-network` route. Allows users to browse available social platforms and initiate an OAuth connection. Migrated from `connect-network.html`.

## ADDED Requirements

### Requirement: Modal-style overlay layout
The connect network page SHALL render as a centered modal-style card with a blurred background overlay of the dashboard.

#### Scenario: Modal card renders with backdrop
- **WHEN** the user navigates to `/admin/connect-network`
- **THEN** a blurred dashboard backdrop SHALL be visible behind a centered glass panel card with rounded corners and a purple glow shadow

#### Scenario: Close button navigates back
- **WHEN** the user clicks the close button in the card header
- **THEN** the app SHALL navigate back to `/admin/connections`

### Requirement: Header with title and search
The connect network page SHALL render a header with title, description, and a search input.

#### Scenario: Header renders correctly
- **WHEN** the page loads
- **THEN** the header SHALL display "Conectar Nueva Red" title, "Expande tu ecosistema de marketing digital" subtitle, and a search input placeholder "Buscar plataformas (ej. Instagram, X, TikTok...)"

### Requirement: Available networks grid
The connect network page SHALL render a grid of available social platforms as selectable cards.

#### Scenario: Network cards display for each platform
- **WHEN** the page loads
- **THEN** cards SHALL display for TikTok, YouTube, LinkedIn, Facebook, and Pinterest, each with a platform-specific icon, title, description, and a "Conectar" or "Conectar Ahora" button

#### Scenario: Recommended platform is highlighted
- **WHEN** the page loads
- **THEN** the LinkedIn card SHALL have a "Recomendado" badge and a prominent gradient "Conectar Ahora" button

#### Scenario: Request network card renders
- **WHEN** the page loads
- **THEN** a dashed-border "Solicitar Red" card SHALL display as the last grid item, with a plus icon

### Requirement: Footer with security info
The connect network page SHALL render a footer with OAuth security notice and support links.

#### Scenario: Footer renders correctly
- **WHEN** the page loads
- **THEN** a footer SHALL display "Conexión segura vía OAuth 2.0" notice, a "Ver tutorial" button, and a "Soporte técnico" link
