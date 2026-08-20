# Spec: Connections Dashboard

## Overview

Connections management page at the `/admin/connections` route. Displays connected and available social network integrations with status indicators. Migrated from `connections.html`.

## ADDED Requirements

### Requirement: Sidebar navigation
The connections dashboard SHALL render a sidebar consistent with the admin layout, with "Conexiones" highlighted as active.

#### Scenario: Sidebar renders with active connections item
- **WHEN** the user navigates to `/admin/connections`
- **THEN** a sidebar SHALL display with "Aura" branding and company name, navigation links where "Conexiones" is highlighted with purple background, and "Cerrar Sesión" at the bottom

### Requirement: Welcome header with info card
The connections dashboard SHALL render a welcome message and informational card.

#### Scenario: Welcome header renders
- **WHEN** the connections dashboard loads
- **THEN** a welcome heading SHALL display "Hola, {company name}" with the company name in primary color

#### Scenario: Info card instructs user
- **WHEN** the connections dashboard loads
- **THEN** an info card SHALL display an explanation about linking social media accounts for automated publishing via Telegram

### Requirement: Social network cards grid
The connections dashboard SHALL render a responsive grid of social network cards with status and action buttons.

#### Scenario: Network cards display for each platform
- **WHEN** the connections dashboard loads
- **THEN** cards for Instagram, X/Twitter, Facebook Page, LinkedIn, and a "Puente Telegram" card SHALL display in a grid layout

#### Scenario: Disconnected networks show connect button
- **WHEN** a network is not connected (e.g., Instagram, Facebook, LinkedIn)
- **THEN** the card SHALL display a red "Desconectado" badge and a "Conectar cuenta" gradient button that navigates to `/admin/connect-network`

#### Scenario: Connected networks show revoke option
- **WHEN** a network is connected (e.g., X/Twitter)
- **THEN** the card SHALL display a green "Conectado" pulsing badge, the connected account name, and a "Revocar acceso" button

### Requirement: Floating action button
The connections dashboard SHALL render a fixed floating action button to add a new network.

#### Scenario: FAB navigates to connect network
- **WHEN** the user clicks the floating "Nueva Red" button
- **THEN** the app SHALL navigate to `/admin/connect-network`

### Requirement: Connect button simulation
The connections dashboard SHALL show a simulated connecting state when clicking inline connect buttons.

#### Scenario: Inline connect shows loading state
- **WHEN** the user clicks a non-navigating "Conectar" button on a network card
- **THEN** the button SHALL show a spinning sync icon with "Conectando..." text for 1.5 seconds, then display an alert "Conexión iniciada con éxito (Simulación)"
