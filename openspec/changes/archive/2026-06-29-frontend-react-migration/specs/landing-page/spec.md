# Spec: Landing Page

## Overview

Public-facing landing page at the `/` route. Merges the desktop landing (`index.html`) and mobile landing (`mobile/index.html`) into a single responsive React component. Serves as the marketing homepage for Aura AI Marketing Automation.

## ADDED Requirements

### Requirement: Hero section with value proposition
The landing page SHALL render a hero section with a badge, headline, description, and two CTA buttons.

#### Scenario: Hero renders with all elements
- **WHEN** the landing page loads at `/`
- **THEN** the user SHALL see an "IA DE ÚLTIMA GENERACIÓN" badge, a headline mentioning "Inteligencia Artificial", a description paragraph, a primary "Hablar con un asesor" button, and a secondary "Ver Demo" button

#### Scenario: CTA buttons have working interactions
- **WHEN** the user hovers over either CTA button
- **THEN** the button SHALL display a hover effect (brightness increase or scale animation)

### Requirement: Navigation bar
The landing page SHALL render a fixed top navigation bar with the Aura brand name, nav links, login button, and contact button.

#### Scenario: Nav bar renders with correct links
- **WHEN** the landing page loads
- **THEN** the nav bar SHALL display "Aura" brand, links to "Beneficios" and "Cómo funciona" sections, an "Iniciar Sesión" button, and a "Contactar" button

#### Scenario: Login button navigates to login page
- **WHEN** the user clicks "Iniciar Sesión"
- **THEN** the app SHALL navigate to `/login`

#### Scenario: Nav links scroll to sections
- **WHEN** the user clicks "Beneficios" or "Cómo funciona"
- **THEN** the page SHALL scroll smoothly to the corresponding section

### Requirement: Beneficios section with feature cards
The landing page SHALL render three glass-morphism feature cards describing Aura's capabilities.

#### Scenario: Three feature cards render
- **WHEN** the user scrolls to the "Beneficios" section
- **THEN** three cards SHALL be visible titled "Análisis Inteligente", "Estudio Creativo", and "Piloto Automático", each with an icon, description, and bullet points

#### Scenario: Glass cards have hover effects
- **WHEN** the user hovers over a feature card
- **THEN** the card SHALL display a purple border glow, translate upward, and show a shadow

### Requirement: Cómo funciona section with step indicators
The landing page SHALL render a three-step process explanation with numbered step indicators.

#### Scenario: Three steps render
- **WHEN** the user scrolls to the "Cómo funciona" section
- **THEN** three steps SHALL display with numbers 1, 2, and 3, each with a title and description

### Requirement: CTA section with WhatsApp button
The landing page SHALL render a final call-to-action section with a WhatsApp integration button.

#### Scenario: WhatsApp CTA renders
- **WHEN** the user scrolls to the final section
- **THEN** a CTA card SHALL display with a WhatsApp button linking externally

### Requirement: Footer with links
The landing page SHALL render a footer with brand info, navigation links, social icons, and copyright.

#### Scenario: Footer renders correctly
- **WHEN** the user scrolls to the bottom
- **THEN** the footer SHALL display "Aura" branding, "Privacidad", "Términos", "Contacto" links, social icon buttons, and a copyright notice

### Requirement: Responsive mobile behavior
The landing page SHALL adapt to mobile viewports by hiding desktop-only elements and adjusting layout.

#### Scenario: Mobile nav differs from desktop
- **WHEN** the viewport width is below 768px
- **THEN** the nav bar SHALL show a compact layout with smaller buttons and no section links; the hero headline SHALL use the mobile font size variant

#### Scenario: Feature cards stack vertically on mobile
- **WHEN** the viewport width is below 768px
- **THEN** the three feature cards SHALL stack in a single column layout

### Requirement: Glass card mouse parallax effect
The landing page SHALL implement a subtle mouse-tracking effect on glass cards.

#### Scenario: Glass cards respond to mouse position
- **WHEN** the user moves their mouse over a glass card
- **THEN** CSS custom properties `--mouse-x` and `--mouse-y` SHALL be updated on the card element
