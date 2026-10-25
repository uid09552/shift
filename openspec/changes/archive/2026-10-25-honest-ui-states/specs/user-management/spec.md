# Spec Delta

## ADDED Requirements

### Requirement: Sign-in through Keycloak only
Users SHALL sign in and register only through Keycloak. The application SHALL NOT offer a sign-in or sign-up form of its own, and SHALL NOT link to one from its navigation.

#### Scenario: Navigation
- **WHEN** a signed-in user opens the sidebar
- **THEN** it has no sign-in or sign-up entry

#### Scenario: Old link
- **WHEN** a user opens `/signin` or `/signup`
- **THEN** the not-found page is shown and no credentials can be entered
