# The API layer

**In short:** pages never talk to the server themselves. Every request goes through one small module, `js/api/client.js`, which sends the session cookie only to our own server, adds the anti-forgery (CSRF) token to requests that change something, turns every failure into one of two kinds of JavaScript error (the server answered with an error, or no answer arrived), and asks for the password again when the server requires it. Getting this right once makes it right on every page.

Decisions: [0005 plain JavaScript, one API layer](https://github.com/workforce-ops-app/.github/blob/main/docs/decisions/0005-frontend-multi-page-vanilla-js.md) · [0026 API conventions](https://github.com/workforce-ops-app/.github/blob/main/docs/decisions/0026-api-conventions.md) · [authentication design](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/architecture/authentication.md)

## Using it

```js
import { api, ApiError, NetworkError } from "../api/client.js";

const shifts = await api.get("/api/shifts?from=2026-10-05&to=2026-10-11");
await api.post("/api/time-off-requests", { first_day: "2026-10-20", last_day: "2026-10-22" });

try {
  await api.patch("/api/shifts/0192-abc", { notes: "Bring the keys" });
} catch (error) {
  if (error instanceof ApiError && error.status === 409) {
    // show error.detail next to the shift
  } else if (error instanceof NetworkError) {
    // show "the server could not be reached"
  } else {
    throw error; // a bug in our own code: let it reach the console, never disguise it
  }
}
```

Pages handle `ApiError` and `NetworkError` and let anything else through. A catch that turned every error into "the server could not be reached" would hide real bugs behind a network message.

As modules arrive, each gets its own file in `js/api/` (for example `js/api/shifts.js`) with named functions built on `api`, so pages call `getWeek(departmentId, from)` rather than spelling out paths.

## What every request does

| Rule | Why |
|---|---|
| The path must start with `/api/`, otherwise an error is thrown before anything is sent | a full URL would carry the session cookie to another site |
| `credentials: "same-origin"` | the session cookie goes to our own address only ([0003](https://github.com/workforce-ops-app/.github/blob/main/docs/decisions/0003-same-origin-deployment.md)) |
| `Accept: application/json` always; `Content-Type: application/json` and a JSON body only when there is a body | the API speaks JSON; a GET has no body |
| `X-CSRF-Token` on every request except GET, when a token is set (`setCsrfToken`, at sign-in) | another site cannot read the token, so it cannot forge a request that changes something (threat model S4) |

## Answers

| Answer | Result |
|---|---|
| success | the parsed JSON; `null` for 204 No Content |
| an error with problem details (`application/problem+json`, [errors](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/user/errors.md)) | `ApiError` with `status`, `title`, `detail`, for 422 the field `errors`, for 500 the `errorId` (a reference number a user can quote), `retryAfter` in seconds from a 429's `Retry-After` header, and the full `problem` and response `headers` (for example `Allow` on a 405), so new fields reach pages without changing the client |
| an error that is not JSON (for example an HTML page from a proxy), claims to be JSON but cannot be read, or is valid JSON but not an object (`null`, an array, a string, a number) | `ApiError` with only the status and its standard text; the page's content is never shown, since it could reveal internals, and the status is never lost to a reading error |
| no answer (network down, server not running) | `NetworkError`, with the browser's own error kept as its `cause` for the console; pages show a short "could not reach the server" message |

## Password re-entry

Before a sensitive action the API may answer **403** with problem type **`reauth-required`** ([authentication](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/architecture/authentication.md#password-re-entry-for-sensitive-actions)). The client then calls the handler registered with `onReauthRequired(handler)`. The handler shows the password pop-up and resolves to `true` when the password was accepted. The client then sends the **same request once more**. It never asks twice for one request; if the repeated request also fails, that second error is thrown.

## Tests

`tests/unit/client.test.js` replaces `fetch` with a fake and checks every rule above, including that paths outside `/api/` never reach `fetch`, that GET never carries the CSRF token, that a non-JSON error page's text never appears in the error, that a network failure becomes a `NetworkError`, that `errorId`, `Retry-After`, and other headers are kept, and that re-entry happens at most once. `tests/unit/sign-in.test.js` checks that the sign-in page shows a network failure and an error answer in plain words but lets a bug in its own code through.
