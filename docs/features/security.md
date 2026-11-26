# Security page

- **Status:** built (slice DT7, workforce-ops-app/workforce-ops-frontend#61), against the backend's endpoints (DT5, workforce-ops-app/workforce-ops-backend#131) and its demo events (DT6, workforce-ops-app/workforce-ops-backend#132)
- **Related:** tracker workforce-ops-app/workforce-ops-backend#116 and workforce-ops-app/.github#91; backend: [detection and the security page](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/features/detection.md)

## In short
Owners and administrators see the requests in their company whose input looked like an attack: how many of each type in the last 7 and 30 days, then the events themselves, newest first, with filters. Detection only records; nothing was blocked, and the person got the same answer as anyone else. Every event holds attacker text, so the page shows it as plain text and never as HTML (threat T7).

## Screens

| Screen | Page | Who sees it | Phone / desktop |
|---|---|---|---|
| **Security**: **Last 7 and 30 days** (a table, one row per type: SQL injection, Cross-site scripting, Path traversal, Command injection, Format string or template, the six refused-request types (no permission, another company's record, not found, forged request, wrong password re-entered, too many wrong passwords; backend #92), Held back by the rate cap, Audit log check failed; a type with events this week has an amber edge), then **Events**: filters (**Type**, **Person**, **From**, **To**, **Show events**) and one card per event (a refused request shows the **Permission** refused instead of a pattern, field, and excerpt), 50 at a time with **Load more events** | `pages/admin-security.html`, the **Security** entry of the administration sub-menu | people with `security.view` (Owner and Administrator) | both; laptop first |

Each event card shows, top to bottom: the type and the time (in the company's time zone), then **Pattern** (for example `XSS-02`), **Field** (for example `body.notes`), **Route** (method and route template), **Person** (or "Not signed in"), **Address**, and **Excerpt** (in a monospace face, exactly as stored). A rate-cap summary row shows **Events held back** (how many the cap did not write) instead of a pattern and an excerpt. A missing value reads "None".

## Server requests used

Through `js/api/security.js` (and `js/api/users.js` for the person filter):

| Action | Endpoint |
|---|---|
| The counts per type | `GET /api/security-events/summary`: `{kinds: [{kind, last_7_days, last_30_days}]}` |
| One page of events, newest first | `GET /api/security-events?limit=50`, with `kind`, `user_id`, `from`, `to` when chosen, then `&cursor=<next_cursor>` |
| The people for the Person filter | `GET /api/users?limit=200` (all pages), only with `user.view` |

## The API answer the screens expect

From the backend design ("Backend" in detection.md): each event has `id`, `kind`, `pattern_id`, `field`, `method`, `route`, `user_id`, `user_name`, `client_address`, `request_id`, `excerpt` (exactly as stored), `count`, and `occurred_at` (UTC). `from` and `to` are days (`YYYY-MM-DD`) in the company's time zone, both included. Both endpoints answer 403 without `security.view`, and 422 for filters they refuse.

## Notes
- **Text only** (threat T7): the excerpt, the field, the route, and the person's name can all carry attacker text, so every value is set with `el()`, which sets `textContent`; nothing is parsed as HTML (`innerHTML` and its relatives are refused by ESLint's `no-unsanitized`). The Content Security Policy is the second defense. The demo data includes `<img src=x onerror=alert(1)>` as an excerpt on purpose, so the demo can show it as text.
- **Where it lives:** under Administration, as the last entry of the sub-menu, rather than as an eighth tab in every page's tab bar. The Administration tab is now also shown with `security.view` (`data-permission-any` on every page).
- **Only a convenience** (threat E8): the entry is shown only with `security.view`, and the API refuses everyone else. A direct visit without it shows "You do not have access to security events." in both status lines, and no events.
- **Filters:** the type list is every kind the API knows; an unknown kind from a newer server is shown by its code, so nothing is hidden. The person list is the company's people by name, only with `user.view` (owners and administrators have it); without it, or if it cannot load, the filter is left out and the events still show. A last day before the first is refused on the page with a sentence, before any request; the server checks again. Each **Show events** starts the list again from the newest, and **Load more events** continues with the same filters. Loads are counted, so an older answer arriving late never adds to a newer list.
- **The counts table** lists the known types in a fixed order, zero included, then any others the server sends. Rows and columns have header cells (`scope`), so screen readers read "Cross-site scripting, Last 7 days, 2".
- **Not shown:** `request_id` (it links to the application log, which the page does not show). Events from people not signed in (`platform_security_events`) have no endpoint, so they are not on this page.

## Tests

- `tests/unit/security-page.test.js`: the counts (order, zero for missing types, words for each type, table headers, recent types marked); an event card (every value as text with `<img onerror>` in the excerpt, field, route, and name, only the card's own elements created; the time in Chicago; a rate-cap summary; "None" and "Not signed in"); the days check; the page (the first requests, the type and person choices, no person filter without `user.view`, filtering from the newest, no request for days the wrong way round, Load more with the cursor and the same filters, the empty state, the no-access state, the server's reason for refused filters).
- `tests/integration/security.spec.js` (Chromium, Firefox, WebKit, behind nginx and its real policy): an `<img src=x onerror=alert(1)>` excerpt shows as text with no image, no dialog, and nothing refused; the counts table; the Security entry marked as the current page; and without `security.view` no link and the no-access line.
- `tests/integration/smoke.spec.js` includes the page among the signed-in pages that send a signed-out visitor to sign in and stay hidden until the session has loaded.
