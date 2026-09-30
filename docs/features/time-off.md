# Time-off requests

- **Status:** planned (core tier)
- **Related:** workforce-ops-app/workforce-ops-frontend#3; backend: [time-off requests](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/features/time-off.md)

## In short
Employees ask for days off and follow their requests; managers see the requests waiting for them, with the shifts each one affects, and approve or deny. Kept short on purpose; details are added when the screens are built.

## Screens

| Screen | Page | Who sees it | Phone / desktop |
|---|---|---|---|
| **My time off**: my requests and their status; "Request time off" form (first and last day, optional reason; the first day is tomorrow or later) | `pages/time-off.html` | everyone | phone first |
| **Waiting for my review**: requests I can decide, each with the affected shifts and other reviewers' decisions; approve, or deny with a comment | `pages/time-off-review.html` | people with `time_off.review` | both |
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

## Notes
- The date picker does not offer today or earlier days; the server checks again.
- Before sending, the form shows which of the person's shifts fall on those days.
- The reason and the reviewer's comment are shown with `textContent`.
- In the core tier there are no notifications: reviewers see a count of waiting requests in the menu, refreshed when a page loads.
