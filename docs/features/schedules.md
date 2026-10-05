# Schedules

- **Status:** My week and the department week are built and styled, on sample data until the shifts API exists (backend SC1); edit mode is planned (core tier)
- **Related:** workforce-ops-app/workforce-ops-frontend#3; backend: [schedules and shifts](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/features/schedules.md)

## In short
Employees see their upcoming shifts and their department's week; managers plan the week, fill open shifts, and cancel or reassign shifts. Times are always shown in the workplace's time zone. Kept short on purpose; details are added when the screens are built.

## Screens

| Screen | Page | Who sees it | Phone / desktop |
|---|---|---|---|
| **My week**: your shifts for one week, a card per day (days off show "No shift"), previous and next week, and the hours scheduled that week | `pages/my-shifts.html` | everyone | phone first; the home page after signing in |
| **Department week**: one department's week with who works each shift, open shifts highlighted in amber | `pages/schedule.html` | people with `schedule.view` (employees see their own department by default) | both; day cards one under another on phones and tablets, the seven days side by side on wide screens |
| **Edit mode** of the department week: add, change, assign, make open, cancel; select several shifts for a batch change | same page, shown only with `schedule.edit` | managers, administrators, owners | desktop first; usable on a tablet |
| **Confirm batch change**: "This will change 14 shifts." | a dialog on the same page | managers | both |

## Server requests used

Through `js/api/shifts.js`:

| Action | Endpoint |
|---|---|
| List shifts for a week or date range | `GET /api/shifts?from=&to=&department_id=` (or `employee_id` = self) |
| One shift | `GET /api/shifts/{id}` |
| Add / change | `POST /api/shifts`, `PATCH /api/shifts/{id}` |
| Assign, or make open | `POST /api/shifts/{id}/assign` |
| Cancel | `POST /api/shifts/{id}/cancel` |
| Several at once | `POST /api/shifts/batch` with `confirm_count` when 10 or more shifts change |
| Departments and people to choose from | `GET /api/departments`, `GET /api/users` |

## The API answer the screens expect

Agreed for the shifts API (workforce-ops-app/workforce-ops-backend#61), following [0026](https://github.com/workforce-ops-app/.github/blob/main/docs/decisions/0026-api-conventions.md):

```
GET /api/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD[&department_id=...][&mine=true][&cursor=...]
{ "items": [Shift, ...], "next_cursor": "..." | null }
```

Each shift: `id`, `department` (`id`, `name`), `employee` (`id`, `display_name`, or `null` for an open shift), `starts_at` and `ends_at` (UTC), `timezone`, `status`, `details`, `notes`, `event_name`, `event_description`. The department and employee names are included so the week can be shown without separate requests for departments and people, which arrive after the midterm. `mine=true` lists the signed-in person's own shifts, as time off does.

**Until the API exists**, `js/api/shifts.js` returns sample data shaped exactly like this answer (`js/api/sample-shifts.js`, built around the current week). Connecting the real API means setting `USE_SAMPLE_DATA` to `false` and deleting the sample file; the screens do not change.

## Notes
- **Time zones:** each shift carries its `timezone`; the page formats times in that zone with `Intl.DateTimeFormat`, not in the viewer's own zone (`js/core/time.js`). A shift belongs to the day it starts in its workplace zone, so a 22:00 shift stays on its own day even though it is already the next day in UTC.
- **Addresses:** both pages read `?week=YYYY-MM-DD` (the department week also `&department=<id>`) (any day of the week works; without a week it shows the current one), so a week can be bookmarked or shared. Previous and next week links keep the department.
- **Edit buttons** appear only when the session's permissions include `schedule.edit`; this is a convenience, the API checks every change.
- **Details, notes, and event text** are shown with `textContent`, never as HTML.
- A 409 answer (double booking, time off, a shift that has ended) is shown next to the shift in plain words.
