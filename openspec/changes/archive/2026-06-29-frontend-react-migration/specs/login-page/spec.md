# Spec: Login Page

## Overview

Authentication page at the `/login` route. Provides a centered login form with email, password, remember-me checkbox, and a submit button. Migrated from `login.html`.

## ADDED Requirements

### Requirement: Login form renders
The login page SHALL render a centered login form with email and password fields.

#### Scenario: Login form displays correctly
- **WHEN** the user navigates to `/login`
- **THEN** a centered glass card form SHALL display with an email input (with `alternate_email` icon), a password input (with `lock` icon and visibility toggle), a "Recordar sesión" checkbox, and an "Iniciar Sesión" submit button

#### Scenario: Email input has validation
- **WHEN** the user types in the email field
- **THEN** the field SHALL accept email format input and show focus styling (purple border ring)

#### Scenario: Password visibility toggle works
- **WHEN** the user clicks the visibility icon in the password field
- **THEN** the password SHALL toggle between hidden and visible text, and the icon SHALL change between `visibility` and `visibility_off`

### Requirement: Brand header and ambient glow
The login page SHALL render a brand header with the Aura logo and animated ambient background glow.

#### Scenario: Brand header renders
- **WHEN** the login page loads
- **THEN** the page SHALL show a gradient Aura logo icon, "Aura" title, and "Marketing AI Ecosystem" subtitle above the form

#### Scenario: Ambient glow animation plays
- **WHEN** the login page loads
- **THEN** the background SHALL display two animated radial gradient glow orbs that pulse alternately

### Requirement: Forgot password link and footer
The login page SHALL display a "¿Olvidaste tu contraseña?" link and a footer with language selector, privacy, and terms.

#### Scenario: Forgot password link renders
- **WHEN** the login form loads
- **THEN** a "¿Olvidaste tu contraseña?" link SHALL display next to the password label

#### Scenario: Footer renders with links
- **WHEN** the login page loads
- **THEN** the footer SHALL display "Español (Latam)" language button, "Privacidad" link, and "Términos" link

### Requirement: New user prompt
The login page SHALL display a prompt for users without an account.

#### Scenario: Contact prompt renders
- **WHEN** the login page loads
- **THEN** a message SHALL display: "¿Aún no tienes cuenta? Contacta a un asesor" with the contact text styled in primary color
