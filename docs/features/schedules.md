# Schedules

- **Status:** planned (core tier)
- **Related:** workforce-ops-app/workforce-ops-frontend#3; backend: [schedules and shifts](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/features/schedules.md)

## In short
Employees see their upcoming shifts and their department's week; managers plan the week, fill open shifts, and cancel or reassign shifts. Times are always shown in the workplace's time zone. Kept short on purpose; details are added when the screens are built.

## Screens

| Screen | Page | Who sees it | Phone / desktop |
|---|---|---|---|
| **My shifts**: upcoming shifts as a list, with details, notes, and event | `pages/my-shifts.html` | everyone | phone first; the home page after signing in |
| **Department week**: one department's week, open shifts highlighted | `pages/schedule.html` | people with `schedule.view` (employees see their own department by default) | both; a day-by-day list on phones, a grid on desktop |
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

## Notes
- **Time zones:** each shift carries its `timezone`; the page formats times in that zone with `Intl.DateTimeFormat`, not in the viewer's own zone.
- **Edit buttons** appear only when the session's permissions include `schedule.edit`; this is a convenience, the API checks every change.
- **Details, notes, and event text** are shown with `textContent`, never as HTML.
- A 409 answer (double booking, time off, a shift that has ended) is shown next to the shift in plain words.
