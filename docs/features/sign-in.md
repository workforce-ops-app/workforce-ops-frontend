# Sign in and your account

- **Status:** the sign-in screen is connected to backend authentication (S2). Every signed-in page loads the session, shows the person's name and a Sign out button, and sends signed-out visitors here (UI1, [session and navigation](../architecture/session-and-navigation.md)). Setting a password from a link, the password re-entry pop-up, and My account are built (UI2b, #21). Asking for a name change is Stretch (#73).
- **Related:** workforce-ops-app/workforce-ops-frontend#3; backend: [authentication](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/architecture/authentication.md), [company structure](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/features/organization.md)

## In short
The screens for getting in and out: signing in with email and password, setting a password from a setup or reset link, the pop-up that asks for the password again before a risky action, and a small "my account" page for changing your password and signing out everywhere. Asking for a name change is Stretch (#73). Kept short on purpose; details are added when the screens are built.

## Current implementation

The sign-in page (`pages/sign-in.html`) uses `js/pages/sign-in.js` to validate input and submit credentials through `js/api/sessions.js`.

- Required fields and email formatting are validated before contacting the backend, with inline error messages instead of browser popups.
- `POST /api/sessions` authenticates the user and creates a server-side session. The browser handles the secure, HttpOnly session cookie.
- Successful authentication redirects to `/pages/my-shifts.html`.
- Incorrect credentials produce a generic error that does not reveal whether an email address belongs to an account.
- Server failures include a reference number when one is available, rate limits explain when to retry, and network failures display a separate connection error.
- The submit button is disabled while a request is in progress, and cached back-navigation clears the password for shared-computer safety.

Every signed-in page loads the session first, shows only the menu entries the person may use, and has a Sign out button in the header (UI1, #13; [session and navigation](../architecture/session-and-navigation.md)). The person's name in the header links to My account.

**Set your password** (`pages/set-password.html`, `js/pages/set-password.js`):
- The backend's links have the address `/set-password.html#token=...` (backend `app/auth/links.py`). nginx redirects that address to `/pages/set-password.html` ([nginx](../architecture/nginx.md)); browsers keep the `#token=...` part across a redirect and never send it to a server, so it never appears in any log.
- The page reads the token once, keeps it in memory, and removes it from the address bar at once with `history.replaceState`, before anything is sent.
- It checks the length rules and that both entries match before sending. The server checks again and has the last word: a company's longer minimum, common passwords, and passwords containing the person's or the company's name are refused there, and its reason is shown as text.
- Every reason a link does not work (used, expired, replaced, unknown) gets one message, because the server gives one answer (400). The form is then hidden: that link will not start working.
- Once set, the fields are cleared and the page points to Sign in. It does not sign the person in: signing in with the new password is the proof that it was saved as meant.

**The re-entry pop-up** (`js/components/reauth-dialog.js`): every signed-in page registers it with the API client when it starts (`startSignedInPage`). On a `403` with type `reauth-required` the client shows it; the password goes to `POST /api/sessions/current/reauth`, and once it is accepted the original request is sent once more. A wrong password keeps the pop-up open with a message; **Go back** resolves without repeating the request, so the page shows the original 403 as a refusal. The password is cleared once accepted and never kept.

**My account** (`pages/account.html`, `js/pages/account.js`):
- Shows who is signed in (as text).
- Change your password: current password, the new one twice, the rules shown. `PUT /api/me/password` signs out every other browser and answers with a new session for this one; the page hands its new CSRF token to the API client at once, since the old token ended with the old session. A wrong current password (403) is said plainly. A hidden `username` field holding the email lets password managers save the new password under the right account.
- Sign out everywhere: asks first ("Are you sure?"), then `DELETE /api/sessions` ends every session, this one too, and the page goes to Sign in.

## Screens

| Screen | Page | Who sees it | Phone / desktop |
|---|---|---|---|
| **Sign in**: the application's logo and name, then email, password, one error message for every failure | `pages/sign-in.html` | everyone, before signing in | both; phone first |
| **Set your password**: from a setup or reset link; shows the password rules (at least 15 characters, passphrases welcome) | `pages/set-password.html` | anyone with a valid link | both; phone first |
| **Password re-entry pop-up**: shown before a sensitive action, then the action is retried | a component on any page (`js/components/reauth-dialog.js`) | signed-in users doing a sensitive action | both |
| **My account**: change password, sign out everywhere; later (Stretch, #73): ask to change your display name and see pending requests | `pages/account.html` | every signed-in user | both |

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
| Ask for a name change (Stretch, #73) | `POST /api/me/account-changes` |

## Security notes
- **One error message** for every sign-in failure ("Email or password is incorrect. After several failed attempts, sign-in is paused for a while."); the page never says whether the email exists.
- **The link token lives after `#`.** `set-password.html` reads it, sends it in the request body, then removes it from the address bar with `history.replaceState`, so it is not left in the browser history.
- **Re-entry:** when a request fails with the problem type `reauth-required`, `client.js` opens the pop-up, sends the password, and repeats the original request once.
- The session cookie is `HttpOnly`, so no script can read it; the page only ever holds the CSRF token, in memory.
- Password fields use `autocomplete="current-password"` or `"new-password"` so password managers work, and allow pasting.
- **The form uses `method="post"`.** The script sends it, but if the script ever fails to load and the browser sends the form itself, the password travels in the request body. With the default `GET` it would end up in the address bar, the browser history, and server logs.
