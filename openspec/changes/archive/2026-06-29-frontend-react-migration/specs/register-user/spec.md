# Spec: Register User

## Overview

Dedicated register user page at the `/admin/register-user` route. Provides a form to create new user accounts with role selection. Extracted from the modal in `admin-panel.html` and enhanced from `register-user.html`.

## ADDED Requirements

### Requirement: Registration form renders
The register user page SHALL render a full-page centered form with all input fields.

#### Scenario: Form displays with all fields
- **WHEN** the user navigates to `/admin/register-user`
- **THEN** a glass panel SHALL display with fields: Nombre Completo, Empresa, Correo Electrónico, Contraseña Temporal, and ID de Chat de Telegram

#### Scenario: Form has role selection
- **WHEN** the user navigates to `/admin/register-user`
- **THEN** two role radio options SHALL display: "User" with a person icon and "Admin" with a verified_user icon, styled as selectable cards

#### Scenario: Role selection highlights active option
- **WHEN** the user selects a role
- **THEN** the selected card SHALL show a purple border and background highlight

### Requirement: Form submission flow
The registration form SHALL show a loading state on submission.

#### Scenario: Submit shows loading state
- **WHEN** the user fills the form and clicks "Crear Usuario"
- **THEN** the button SHALL show a spinning icon and "Procesando..." text, become disabled, then after a simulated delay show a success state with "Usuario Creado" and green background

#### Scenario: Cancel button navigates back
- **WHEN** the user clicks "Cancelar"
- **THEN** the app SHALL navigate back to the admin dashboard

### Requirement: Password visibility toggle
The password field SHALL include a visibility toggle button.

#### Scenario: Password toggle works
- **WHEN** the user clicks the visibility icon in the password field
- **THEN** the password SHALL toggle between hidden and visible text
