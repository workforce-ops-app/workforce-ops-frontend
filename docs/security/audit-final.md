# Final audit: the screens (OWASP ASVS 5.0, Level 2)

**In short:** the connected screens checked against the ASVS Level 1 and 2 requirements that concern the browser side, with both teammates attacking the whole application together ([0030](https://github.com/workforce-ops-app/.github/blob/main/docs/decisions/0030-security-study-method.md)). It finishes what the backend's [midterm audit](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/security/audit-midterm.md) left to the frontend, rechecks the browser-facing rows it passed, and types attack inputs into every text field. Its findings feed the findings log and research question RQ3 (which part of the system is the most vulnerable).

- **Status:** prepared, not run yet. The checklists below are ready; every Result column is empty until the audit runs
- **Related:** #62 (this audit), the tools in workforce-ops-app/workforce-ops-research `audit/` (the XSS inputs, ZAP), the backend's [outside-attacker audit](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/security/audit-external.md) (workforce-ops-app/workforce-ops-backend#119), [architecture](../architecture/README.md)

## Scope

- **What:** every screen on `review/integration` of the frontend, against the backend's `review/integration`, as the research repository's audit README starts them. Record the two commits when the audit starts: frontend `________`, backend `________`.
- **Who attacks:** both teammates together, every screen, signed in as each kind of person in the demo data (owner, administrator, manager, employee) and signed out.
- **Where:** a local copy only, in Chrome, Firefox, and WebKit or Safari (the browsers the Playwright tests run).
- **Not covered:** hosting (HTTPS, HSTS), deferred as in the midterm audit; the API's own rules, which the backend audits cover.

## Method

1. Start the local copy and note both commits above.
2. Run `audit/run_zap.sh baseline` from the research repository (headers, cookies, and what the pages expose).
3. Work through the requirements below with the browser's developer tools and Burp Suite Community, writing each result and its evidence.
4. The XSS pass: type each line of `audit/xss-inputs.txt` into every field in the table below, save, then open every screen that shows that value again (the "Shown on" column). Watch the console for CSP violations: a violation means something tried to run, even though the policy stopped it, and is a finding.
5. Each finding gets an issue from the security-finding template, a row in the Findings table, and, once fixed, a row in the backend's [findings log](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/security/findings-log.md) with its tool, fix, regression test, threat ID, and attacker profile.

**Results:** **Pass** (holds, and the evidence shows it); **Finding** (does not: file it); **N/A** (nothing in the screens it applies to; say why); **Deployment** (depends on hosting).

## Requirements

The ID, level, and summary are as in the midterm audit; the full wording is in ASVS 5.0.0 under the same ID.

| ID | L | Requirement (summary) | Where to look | Result | Evidence |
|---|---|---|---|---|---|
| V3.2.1 | 1 | API answers cannot be rendered as pages | API answers served through nginx: JSON content type, `nosniff`, the CSP (`nginx/nginx.conf`); open an API address directly in the browser | | |
| V3.2.2 | 1 | Text is shown with safe functions | every place data reaches a page: `el()` and `setText` in `js/core/dom.js`; lint refuses `innerHTML` (`eslint-plugin-no-unsanitized`); the XSS pass below | | |
| V3.3.1 | 1 | Cookies are Secure with a __Host- or __Secure- prefix | the cookie after sign-in and after sign-up (browser storage panel) | | |
| V3.3.2 | 2 | SameSite fits each cookie's purpose | the same cookie: `SameSite=Strict` | | |
| V3.3.3 | 2 | Cookies use the __Host- prefix | the same cookie: `__Host-` prefix, `Path=/`, no `Domain` | | |
| V3.3.4 | 2 | Session cookies are HttpOnly | the same cookie: `HttpOnly`; `document.cookie` in the console does not show it | | |
| V3.4.1 | 1 | HSTS for at least a year | deferred to hosting, as in the midterm audit (no HTTPS copy) | | |
| V3.4.2 | 1 | CORS origin is fixed or allowlisted | no CORS headers on any answer (ZAP baseline, Burp) | | |
| V3.4.3 | 2 | Content-Security-Policy | the CSP on every page (`nginx/nginx.conf`); the console shows no CSP violation on any screen; no inline script or style | | |
| V3.4.4 | 2 | X-Content-Type-Options: nosniff | `X-Content-Type-Options: nosniff` on pages, scripts, styles, and images | | |
| V3.4.5 | 2 | Referrer-Policy | `Referrer-Policy` on every answer; no token in any `Referer` (the set-password page) | | |
| V3.4.6 | 2 | frame-ancestors in the CSP | `frame-ancestors 'none'`: try framing a page from a local HTML file | | |
| V3.5.1 | 1 | Cross-origin requests to sensitive functions are refused | forged requests from another origin are refused (outside-attacker audit, S4); the pages send `X-CSRF-Token` (`js/api/client.js`) | | |
| V3.5.2 | 1 | If relying on CORS preflight, it cannot be skipped | not relied on | | |
| V3.5.3 | 1 | Changes use POST, PUT, PATCH, or DELETE | no screen changes anything with GET (Burp history while using every screen) | | |
| V3.5.4 | 2 | Separate applications on separate hostnames | one application | | |
| V3.5.5 | 2 | postMessage origins are checked | search the code for `postMessage` and `message` listeners | | |
| V3.7.1 | 2 | Only supported client technologies | only plain JavaScript modules, CSS, and images; no plugins or outdated browser features | | |
| V3.7.2 | 2 | Redirects to other hosts only from an allowlist | no page sends the browser to another host (search for `location`, `assign`, and links built from data) | | |
| V6.2.6 | 1 | Password fields are masked | every password field is `type="password"`: sign-in, sign-up, set-password, My account, the re-entry pop-up | | |
| V6.2.7 | 1 | Paste and password managers work | paste works and password managers fill and save (`autocomplete` values) on the same fields | | |
| V8.3.1 | 1 | Authorization is enforced on the server | hidden buttons and tabs are only convenience: send the hidden actions with Burp as an Employee and see the API refuse (with the internal audit, P2) | | |
| V14.3.1 | 1 | Authenticated data is cleared from the client at the end | after Sign out, Back shows nothing personal; nothing stays in memory or storage | | |
| V14.3.2 | 2 | Anti-caching headers | `Cache-Control` on API answers (`no-store`) and pages (`no-cache`) | | |
| V14.3.3 | 2 | No sensitive data in browser storage | `localStorage`, `sessionStorage`, IndexedDB, and cookies hold nothing about the person (browser storage panel on every screen) | | |
| V15.3.6 | 2 | No prototype pollution in JavaScript | no object merging of data from answers or the address bar; `__proto__` and `constructor` in fields (XSS inputs) change nothing | | |

## The XSS pass

Every field where a person types text that someone (they or others) later sees. Inputs: research `audit/xss-inputs.txt`. A field passes when every input comes back exactly as typed on every screen in "Shown on", nothing runs, and the console shows no CSP violation.

| Screen | Field | Shown on | Result | Evidence |
|---|---|---|---|---|
| Sign up your company (`pages/sign-up.html`) | Company name, Your name, Email | the header after sign-up; Departments and teams; People | | |
| Sign in (`pages/sign-in.html`) | Email | the error message (it must not repeat the input as HTML) | | |
| Set your password, My account | password fields | nowhere (never echoed back) | | |
| People: add or change a person (`pages/admin-people.html`) | Name, Email | People list and details; Reports to; shift cards and the department calendar; approvals and time-off reviews (requester and employee names) | | |
| People: search | the search box | the filtered list | | |
| Departments and teams (`pages/admin-structure.html`) | department name, team name | the department picker on the calendar; People (home department); the "Which one" choices when giving a role | | |
| Roles and owners (`pages/admin-roles.html`) | role name | People (roles held), approvals (the role a request is about), the role names shown with shifts | | |
| Department week, edit mode (shift form) | Role, Event, Notes | shift cards and bars, the shift details pop-up, My week | | |
| Time off (`pages/time-off.html`) | Reason | My requests; Review time off (the reviewer's view) | | |
| Review time off (`pages/time-off-review.html`) | Comment on approve or deny | the employee's My requests (reviewers' comments) | | |
| Announcements (`pages/announcements.html`) | (posting comes with frontend #79; until then, post through the API with Burp) title and body | Announcements; My week (newest three) | | |
| The address bar | `?week=`, `?department=`, `#token=` and any other parameter a page reads | the page that reads it | | |

## Findings

One row per finding, filled during the audit.

| Finding | Requirement or field | Tool | Severity | Issue | Fixed by |
|---|---|---|---|---|---|

## Summary for the report

Filled when the audit ends: results by requirement chapter and by screen, and the findings by severity, for RQ3 ([report plan](https://github.com/workforce-ops-app/.github/blob/main/docs/project/report-plan.md)).
