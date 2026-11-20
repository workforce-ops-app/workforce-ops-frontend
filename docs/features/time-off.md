# Time-off requests

- **Status:** built. My time off (UI5, #17) and Review time off (UI6, #18).
- **Related:** workforce-ops-app/workforce-ops-frontend#3; backend: [time-off requests](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/features/time-off.md)

## In short
Employees ask for days off and follow their requests; managers see the requests waiting for them, with the shifts each one affects, and approve or deny. Kept short on purpose; details are added when the screens are built.

## Screens

| Screen | Page | Who sees it | Phone / desktop |
|---|---|---|---|
| **My time off**: my requests and their status; "Request time off" form (first and last day, optional reason; the first day is tomorrow or later) | `pages/time-off.html` | `time_off.request_self` (the Time off menu entry) | phone first |
| **Waiting for my review**: requests I can decide, each with the affected shifts and other reviewers' decisions; approve, or deny with a comment | `pages/time-off-review.html` | people with `time_off.review` (the Review time off menu entry, with the waiting count) | both |
| **Team requests**: requests of people in my scope, by status and date | tab on the review page, with `time_off.view` | managers, administrators, owners | desktop first |

**Statuses shown to the employee:** Waiting for review, Moved up (managers disagreed), Approved, Declined, Declined: not reviewed in time, Cancelled.

## Server requests used

Through `js/api/time-off.js`:

| Action | Endpoint |
|---|---|
| My requests | `GET /api/time-off-requests?mine=true` |
| Ask for time off | `POST /api/time-off-requests` |
| Cancel my request | `POST /api/time-off-requests/{id}/cancel` |
| Waiting for my review | `GET /api/time-off-requests/waiting` |
| Requests in my scope | `GET /api/time-off-requests?status=&from=&to=` |
| One request, with affected shifts and decisions | `GET /api/time-off-requests/{id}` |
| Approve / deny | `POST /api/time-off-requests/{id}/approve`, `POST /api/time-off-requests/{id}/deny` |

## My time off (built)

`pages/time-off.html`, `js/pages/time-off.js`, `js/api/time-off.js`, `css/pages/time-off.css`. A **Time off** menu entry after My week, shown with `time_off.request_self`.

- **Days** are whole days in the workplace time zone: the home department's own zone when it has one (from the departments list, backend #170), otherwise the company's. The API uses the same rule.
- **The form** offers tomorrow as the earliest first day; the last day cannot be before the first and follows it. Before sending it checks the days in words (first day tomorrow or later, last day not before it, at most 30 days); the API checks again. The reason is optional, at most 500 characters.
- **Before sending**, the person's shifts on those days are listed ("2 of your shifts fall on these days. If approved, they become open shifts for someone else to take:"), from `GET /api/shifts?mine=true`. The preview is a help: if it fails, the request can still be sent. A late answer never replaces a newer one.
- **Your requests**, newest first: the days, the status in plain words, the reason (as text), and a coloured edge (the words say it too). **Cancel request** while it waits, or once approved until its first day; cancelling an approved request does not give the shifts back (backend rule), and the question says so. **Reviewers' comments** on decided requests, loaded when asked (not on one nobody reviewed in time).

## Review time off (built)

`pages/time-off-review.html`, `js/pages/time-off-review.js`. The words shared with My time off (status, days) are in `js/core/time-off-words.js`.

- **Waiting for you:** each request the API says this person may decide now, loaded with its details: who asked and the days, the state ("Moved up to you: the managers who reviewed it disagreed. Your decision settles it." after an escalation), the reason, the shifts it affects (in their department's time zone), and the decisions so far ("Chris Nguyen approved: Fine by me."). Names come from the API (`employee_name`, `approver_name`, backend #172).
- **Approve** and **Deny** open a small form with an optional comment the employee sees. Approving says first how many of the employee's shifts become open shifts if it settles the request. Afterwards the status line says what the request became (approved, declined, moved up, or still waiting for other reviewers), and the lists and the count load again.
- **Team requests** (`time_off.view`): every request of the people in scope, filtered by status.
- **Waiting count:** a red badge on the Review time off menu entry with the number waiting (`aria-label` "3 waiting"), loaded on every signed-in page by `showWaitingCount()` in `js/components/app-shell.js`, without holding the page up. Hidden at zero, without `time_off.review`, or if the request fails. This is how reviewers notice new requests in the core tier (no notifications).

## Notes
- The date picker does not offer today or earlier days; the server checks again.
- Before sending, the form shows which of the person's shifts fall on those days.
- The reason and the reviewer's comment are shown with `textContent`.
- In the core tier there are no notifications: reviewers see a count of waiting requests in the menu, refreshed when a page loads.
