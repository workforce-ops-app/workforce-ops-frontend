# Project Architecture: Frontend

**In short:** how the user interface is put together: pages, the layer that talks to the server, shared components, and the measures that protect users from malicious content.

## Overview

A multi-page site using plain ES modules with no build step ([decision 0005](https://github.com/workforce-ops-app/.github/blob/main/docs/decisions/0005-frontend-multi-page-vanilla-js.md)), served from the same origin as the API through nginx ([decision 0003](https://github.com/workforce-ops-app/.github/blob/main/docs/decisions/0003-same-origin-deployment.md)).

```
pages/                 one HTML file per page
css/{base,components,pages}/
js/
├── api/               client.js + one file per backend module
├── core/              session state, permission-aware UI, safe DOM helpers
├── components/        reusable UI pieces
└── pages/             one entry module per page
```

## Security measures

- Strict Content Security Policy: no inline scripts or `on*=` attributes.
- User data is never assigned to `innerHTML`; lint rules enforce this.
- All requests go through `js/api/client.js`, which sends credentials and the CSRF token and handles errors in one place.
- Hidden buttons are a convenience, never a security control: the backend checks every action.

## Pages

| Page | Status |
|---|---|
| [API layer](api-layer.md) (`js/api/client.js`: requests, CSRF token, errors, password re-entry) | built |
| [Putting content on the page](components.md) (safe DOM helpers, components) | built (helpers); components with the core screens |
| Navigation (permission-driven) | to do |
| [nginx configuration and headers](nginx.md) | built |
