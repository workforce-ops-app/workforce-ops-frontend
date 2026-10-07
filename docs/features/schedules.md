# Schedules

- **Status:** My week and the department week are built and styled for the midterm, on sample data until the shifts API exists (backend SC1); edit mode is planned (core tier)
- **Related:** workforce-ops-app/workforce-ops-frontend#3; backend: [schedules and shifts](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/features/schedules.md)

## In short
Employees see their upcoming shifts and their department's week; managers plan the week, fill open shifts, and cancel or reassign shifts. Times are always shown in the workplace's time zone. Kept short on purpose; details are added when the screens are built.

## Screens

| Screen | Page | Who sees it | Phone / desktop |
|---|---|---|---|
| **My week**: your shifts for one week, a card per day (days off show "No shift"), previous and next week, and the hours scheduled that week | `pages/my-shifts.html` | everyone | phone first; the home page after signing in |
| **Department week**: one department's week, laid out for planning. At the top, tiles with the week's numbers (shifts, open shifts, hours scheduled, people working). Below, on a laptop, a grid with one row per person and one column per day, open shifts in their own amber row at the top, and each person's hours at the end of the row | `pages/schedule.html` | people with `schedule.view` (employees see their own department by default) | laptop first; on phones and tablets (narrower than 64rem) the tiles, then a card per day one under another |
| **Edit mode** of the department week: add, change, assign, make open, cancel; select several shifts for a batch change | same page, shown only with `schedule.edit` | managers, administrators, owners | desktop first; usable on a tablet |
| **Confirm batch change**: "This will change 14 shifts." | a dialog on the same page | managers | both |

## Server requests used

Through `js/api/shifts.js`:

| Action | Endpoint |
|---|---|
| List shifts for a week or date range | `GET /api/shifts?from=&to=&department_id=` (one department's week), or `&mine=true` (your own shifts) |
| One shift | `GET /api/shifts/{id}` |
| Add / change | `POST /api/shifts`, `PATCH /api/shifts/{id}` |
| Assign, or make open | `POST /api/shifts/{id}/assign` |
| Cancel | `POST /api/shifts/{id}/cancel` |
| Several at once | `POST /api/shifts/batch` with `confirm_count` when 10 or more shifts change |
| Departments and people to choose from; the department week's heading | `GET /api/departments`, `GET /api/users` |
| Your own department, which the department week shows by default | `GET /api/sessions/current` (the signed-in person's `department_id`) |

## The API answer the screens expect

Agreed for the shifts API (workforce-ops-app/workforce-ops-backend#61), following [0026](https://github.com/workforce-ops-app/.github/blob/main/docs/decisions/0026-api-conventions.md):

```
GET /api/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD[&department_id=...][&mine=true][&cursor=...]
{ "items": [Shift, ...], "next_cursor": "..." | null }
```

Each shift: `id`, `department` (`id`, `name`), `employee` (`id`, `display_name`, or `null` for an open shift), `starts_at` and `ends_at` (UTC), `timezone`, `status`, `details`, `notes`, `event_name`, `event_description`. The department and employee names are included so the week can be shown without separate requests for departments and people, which arrive after the midterm. `mine=true` lists the signed-in person's own shifts, as time off does.

**Until the API exists**, `js/api/shifts.js` returns sample data shaped exactly like this answer (`js/api/sample-shifts.js`, built around the current week, with fixed IDs shaped like the API's UUIDs). The sample file is loaded only while `USE_SAMPLE_DATA` is `true`. Connecting the real API takes two steps, and the screens do not change:
1. Set `USE_SAMPLE_DATA` to `false`. The screens now use the API, and the browser no longer loads the sample file.
2. Delete `js/api/sample-shifts.js`, together with `sampleData()` and the `USE_SAMPLE_DATA` branches in `js/api/shifts.js`. The type check (`npm run typecheck`) names every line that still refers to them.

## Notes
- **Time zones:** each shift carries its `timezone`; the page formats times in that zone with `Intl.DateTimeFormat`, not in the viewer's own zone (`js/core/time.js`). A shift belongs to the day it starts in its workplace zone, so a 22:00 shift stays on its own day even though it is already the next day in UTC.
- **Daylight saving:** when a wall-clock time is turned into UTC (`zonedTimeToUtc`, for creating shifts), a time that never happens because clocks spring forward (2:30 on the March change in the US) moves forward by the jump (3:30), and a time that happens twice because clocks fall back (1:30 on the November change) means the first one. These are the "compatible" rules of JavaScript's Temporal API.
- **Addresses:** both pages read `?week=YYYY-MM-DD` (the department week also `&department=<id>`), so a week can be bookmarked or shared. Any day of the week works; without a week, or with a day that does not exist (for example `2026-99-99`), the page shows the current week. Previous and next week links keep the department.
- **Which department:** the department week always shows one department, named in the heading, so shifts of different departments are never mixed. Without `&department=` it shows the person's own department (or, for someone without one, the company's first department). The heading comes from the departments list, so a week with no shifts is still named. The address only chooses what to look at; the API decides what the person may see.
- **Edit buttons** appear only when the session's permissions include `schedule.edit`; this is a convenience, the API checks every change.
- **Shifts stay short on the week screens:** each shows its time (and, in the department week, who works it). Clicking or tapping a shift, or pressing Enter on it, opens a popup with the rest: the day, who, role, department, event, and notes. The popup closes with its Close button or the Escape key, and keyboard focus goes back to the shift (`js/components/shift-dialog.js`).
- **Details, notes, and event text** are shown with `textContent`, never as HTML, in the popup as everywhere else.
- A 409 answer (double booking, time off, a shift that has ended) is shown next to the shift in plain words.
