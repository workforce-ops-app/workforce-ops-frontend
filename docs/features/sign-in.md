# Sign in and your account

- **Status:** planned (core tier)
- **Related:** workforce-ops-app/workforce-ops-frontend#3; backend: [authentication](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/architecture/authentication.md), [company structure](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/features/organization.md)

## In short
The screens for getting in and out: signing in with email and password, setting a password from a setup or reset link, the pop-up that asks for the password again before a risky action, and a small "my account" page for changing your password and asking for a name change. Kept short on purpose; details are added when the screens are built.

## Screens

| Screen | Page | Who sees it | Phone / desktop |
|---|---|---|---|
| **Sign in**: email, password, one error message for every failure | `pages/sign-in.html` | everyone, before signing in | both; phone first |
| **Set your password**: from a setup or reset link; shows the password rules (at least 15 characters, passphrases welcome) | `pages/set-password.html` | anyone with a valid link | both; phone first |
| **Password re-entry pop-up**: shown before a sensitive action, then the action is retried | a component on any page (`js/components/reauth-dialog.js`) | signed-in users doing a sensitive action | both |
| **My account**: change password, sign out everywhere, ask to change your display name, see pending requests | `pages/account.html` | every signed-in user | both |

Signing out is a button in the page header on every page.

## Server requests used

All go through `js/api/client.js` ([architecture](../architecture/README.md)); the file per backend module is `js/api/sessions.js` and `js/api/account.js`.

| Action | Endpoint |
|---|---|
| Sign in / out | `POST /api/sessions`, `DELETE /api/sessions/current` |
| Who am I, my permissions, CSRF token | `GET /api/sessions/current` (on every page load) |
| Re-enter password | `POST /api/sessions/current/reauth` |
| Change password / sign out everywhere | `PUT /api/me/password`, `DELETE /api/sessions` |
| Set a password from a link | `POST /api/password-links/redeem` |
| Ask for a name change | `POST /api/me/account-changes` |

## Security notes
- **One error message** for every sign-in failure ("Email or password is incorrect. After several failed attempts, sign-in is paused for a while."); the page never says whether the email exists.
- **The link token lives after `#`.** `set-password.html` reads it, sends it in the request body, then removes it from the address bar with `history.replaceState`, so it is not left in the browser history.
- **Re-entry:** when a request fails with the problem type `reauth-required`, `client.js` opens the pop-up, sends the password, and repeats the original request once.
- The session cookie is `HttpOnly`, so no script can read it; the page only ever holds the CSRF token, in memory.
- Password fields use `autocomplete="current-password"` or `"new-password"` so password managers work, and allow pasting.
