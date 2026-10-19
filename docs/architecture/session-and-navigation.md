# Session and navigation

**In short:** every signed-in page first asks the server who is signed in and what they may do. Someone who is not signed in is sent to the sign-in page. For everyone else the page shows their company's name, their own name and a sign-out button, and only the menu entries they can use. The answer also carries the anti-forgery (CSRF) token that every change must send. Hiding a menu entry or a button only keeps the screen tidy: the server checks every request, so it is never a security control on its own.

## How a page starts

```mermaid
sequenceDiagram
    participant Page as Page script
    participant Shell as app-shell.js
    participant Session as core/session.js
    participant API as GET /api/sessions/current
    Page->>Shell: startSignedInPage(showPage)
    Shell->>Session: loadSession()
    Session->>API: who am I? (session cookie sent by the browser)
    alt signed in (200)
        API-->>Session: user, company, permissions, csrf_token
        Session->>Session: keep it in memory; setCsrfToken(token)
        Shell->>Shell: company name, person's name and sign-out button; show permitted menu entries; show main
        Shell->>Page: showPage()
    else not signed in (401)
        API-->>Session: 401
        Session->>Page: go to /pages/sign-in.html (main stays hidden; the page never loads)
    else server down or 500
        API-->>Session: error
        Shell->>Page: show main and run showPage() anyway, so it shows its usual "Problem: ..."
    end
```

## The pieces

| Piece | File | Does |
|---|---|---|
| `loadSession()` | `js/core/session.js` | `GET /api/sessions/current`, once per page (callers share one request); keeps the answer in memory and hands `csrf_token` to `setCsrfToken`; on 401 forgets everything and goes to the sign-in page; other failures are thrown on |
| `currentSession()`, `can(permission)` | `js/core/session.js` | the loaded session, and whether the person holds a permission somewhere; both answer "nothing" before the session has loaded. Pages read them instead of asking the server again: the department week takes its default department from `user.department_id` and asks for the department's people only with `user.view` |
| `signOut()` | `js/core/session.js` | `DELETE /api/sessions/current` (with the CSRF token, like any change), then forgets the session and goes to the sign-in page; a 401 counts as already signed out, any other failure keeps the person on the page |
| `startSignedInPage(showPage)` | `js/components/app-shell.js` | the start of every signed-in page: session, then the frame, then the page; the page's `<main>` starts `hidden` in the HTML and is shown only after the session check, so a signed-out visitor never sees the heading or week buttons before going to sign in. A "Loading..." line stands in its place until then; it says nothing about the page |
| `applyPermissions()` | `js/components/app-shell.js` | shows each element marked `data-permission="<code>"` only when `can(code)`; such elements start `hidden` in the HTML, so nothing flashes while the session loads |
| `showCompanyName(session)` | `js/components/app-shell.js` | puts `company.name` (as text) in every `.brand__name` and at the end of the tab title ("My week · Northwind Cafe"), in place of "Workforce Operations"; the HTML keeps the application's name, so the home link has a name before the session loads and when it cannot be loaded |
| `accountItems(session)` | `js/components/app-shell.js` | the name (as text) and the Sign out button for the `#account` spot in the header; one request per click, and a plain message when signing out fails |

**Menu entries and their permissions:** My week needs `schedule.view_self`; Department needs `schedule.view` (an administrator can remove it from the Employee role, and the tab then disappears).

## Security notes

- **The session cookie is HttpOnly:** no script can read it. The page only keeps the person, their permissions, and the CSRF token, **in memory**, never in `localStorage` or `sessionStorage`; they are gone when the tab closes.
- **CSRF** (threat model S4): the token comes with the session and is sent as `X-CSRF-Token` on every POST, PATCH, PUT, and DELETE by `js/api/client.js` ([API layer](api-layer.md)). Another site can make the browser send our cookie but cannot read the token.
- **Hidden is not forbidden** (threat model E8): un-hiding a menu entry or button in the browser's developer tools only leads to a page or request the server refuses (403).
- **Fixed sign-in address:** the redirect target is a constant, never taken from the address bar, so the redirect cannot be turned into an open redirect.
- **Names are text:** the display name and the company name are set with `textContent`, so a name containing HTML is shown, not run.
- **Back after signing out:** a browser can show a page again from its back/forward cache without running any script, which would show the last person's schedule on a shared computer. `startSignedInPage` reloads such a page (`reloadIfRestored`), so the session is checked again and a signed-out visitor goes to sign-in.

**Explain in the presentation** (course topics: AJAX and CSRF): `loadSession()` (a background request that fills in the page without reloading it, and the token it hands to the API client), and why the hidden menu entry is not the security control.

## Moving between weeks

Previous and Next do not load the page again: `js/components/week-nav.js` changes the address and fetches only the new week ([components](components.md)). The session, its CSRF token, and the frame stay in memory, so moving between weeks costs no extra session request and nothing in the frame flickers. The session is checked again on every full page load (a new tab, a bookmark, Reload, or a page restored from the back/forward cache).

**Explain in the presentation** (course topic: AJAX): the week is a background request whose answer replaces part of the page, and `history.pushState` keeps the address (and Back) in step with what is shown.

## Not yet

- A session that expires while a page is open shows the page's usual "Problem: Unauthorized" on the next request, including the next week chosen with Previous or Next (the week before is cleared, so no old shifts stay on screen); sending the person to sign in at that moment comes later.
- The password re-entry pop-up (`reauth-required`) comes with the account screens (#21).

## Tests

`tests/unit/session.test.js`: one request per page, the token handed to the client, a 401 going to sign-in, other failures thrown on and retried later, nothing written to browser storage, `can()`, and signing out (including an already-ended session and a failed sign-out). `tests/unit/app-shell.test.js`: menu entries by permission, the name and button, a name containing HTML shown as text, a signed-out visitor never loading or seeing the page, the page staying hidden until the session has loaded, a page restored from the back/forward cache being reloaded, the "Loading..." line giving way to the page, an unreachable server still loading it, one sign-out request per click, and a failed sign-out. `tests/unit/week-nav.test.js`: a week loading in place with the address changed, a click that opens a new tab left to the browser, Back and Forward, the busy mark, one week at a time with the latest click winning, and a failed load not blocking the next one. `tests/integration/smoke.spec.js`: both schedule pages send a signed-out visitor to the sign-in page in real browsers, and stay hidden while the session answer is held back.
