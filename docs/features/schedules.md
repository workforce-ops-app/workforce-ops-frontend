# Schedules

- **Status:** My week and the department week are built and styled for the midterm and show real shifts from the shifts API (workforce-ops-app/workforce-ops-frontend#38); edit mode is built (workforce-ops-app/workforce-ops-frontend#16)
- **Related:** workforce-ops-app/workforce-ops-frontend#3; backend: [schedules and shifts](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/features/schedules.md)

## In short
Employees see their upcoming shifts and their department's week; managers plan the week, fill open shifts, and cancel or reassign shifts. Times are always shown in the workplace's time zone. Kept short on purpose; details are added when the screens are built.

## Screens

| Screen | Page | Who sees it | Phone / desktop |
|---|---|---|---|
| **My week**: your shifts for one week, a card per day (days off show "No shift"; today's card has a soft green background), previous and next week, a shortcut back to the current week, and the hours scheduled that week | `pages/my-shifts.html` | everyone | phone first; the home page after signing in |
| **Department week**: one department's week, laid out for planning. At the top, tiles with the week's numbers (shifts, open shifts, hours scheduled, people working). Below, on a laptop, a grid with one row per person and one column per day, and each person's hours at the end of the row. One day's column is highlighted: the one under the mouse (or holding keyboard focus), else today's. The highlight fades briefly from one column to the next (instantly for people who turn on reduced motion). Under the grid, the **open shifts** in a section of their own (amber, with the day, time, and role). Last, **unscheduled employees**: the department's people without a shift that week, shown only to people allowed to list them | `pages/schedule.html` | people with `schedule.view` (employees see their own department by default) | laptop first; on phones and tablets (narrower than 64rem) the tiles, then a card per day one under another (open shifts inside their day, today's card green), then the unscheduled employees |
| **Edit mode** of the department week: an **Edit week** button switches it on. **Add shift** opens a form (one or more days of the week, start and end, who works it or an open shift, role, event, notes). Each shift that can still change gets a select box; selecting shifts shows a bar at the bottom to assign them to one person, make them open, or cancel them. Clicking a shift opens its details with **Change shift** and **Cancel shift**. Every change loads the week again from the server, and a short line says what happened ("2 shifts changed.") | same page, shown only with `schedule.edit` | managers, administrators, owners | desktop first; works on phones and tablets (the select boxes sit next to the shifts in the day cards) |
| **Confirm batch change**: "This will change 14 shifts." Shown before any batch of 10 or more shifts, which then sends `confirm_count`. Cancelling always asks first, at any count, since a cancelled shift cannot be changed again | a popup on the same page | managers | both |

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
| The department week's heading (the company's active departments, `id` and `name` only, for anyone signed in) | `GET /api/departments` (workforce-ops-app/workforce-ops-backend#88) |
| The department's people, for "Unscheduled employees" | `GET /api/users?department_id=`, asked only when the session includes `user.view`; a 403, or a 404 while the backend's people endpoints do not exist yet (workforce-ops-app/workforce-ops-backend#54), leaves the section out and the rest of the week still shows |
| Your own department, which the department week shows by default | no extra request: the session every signed-in page already loads (`currentSession().user.department_id`, [session and navigation](../architecture/session-and-navigation.md)) |

## The API answer the screens expect

Agreed for the shifts API (workforce-ops-app/workforce-ops-backend#61), following [0026](https://github.com/workforce-ops-app/.github/blob/main/docs/decisions/0026-api-conventions.md):

```
GET /api/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD[&department_id=...][&mine=true][&cursor=...]
{ "items": [Shift, ...], "next_cursor": "..." | null }
```

Each shift: `id`, `department` (`id`, `name`), `employee` (`id`, `display_name`, or `null` for an open shift), `starts_at` and `ends_at` (UTC), `timezone`, `status`, `details`, `notes`, `event_name`, `event_description`. The department and employee names are included so the week can be shown without separate requests for departments and people, which arrive after the midterm. `mine=true` lists the signed-in person's own shifts, as time off does.

`js/api/shifts.js` asks the server every time and follows `next_cursor` until the last page, for shifts and departments alike. There is no built-in sample data: the pages show only what the server returns, so made-up shifts can never appear in a real deployment. To see a populated week locally, run the backend with its demo data (workforce-ops-app/workforce-ops-backend#66) and sign in as one of the demo people.

## Notes
- **Overnight shifts** (for example 10:00 PM to 6:00 AM): a shift is listed on the day it **starts**, and every screen adds a small **+1 day** marker after its time (screen readers hear "ends the next day"); the details popup also says when it ends ("Ends: Tuesday, October 6, 6:00 AM"). In the add and change form, an end time at or before the start time means the shift ends the next day (`shiftMoments` in `js/core/time.js`). This rule is never ambiguous because a shift is at most 12 hours long: an end later than the start can only be the same day, and an end earlier than the start can only be the next day. A line under the times shows the result as it will be saved ("Ends the next day, Tuesday, October 6 at 6:00 AM. 8 hours."), and turns amber with the reason when the shift has no length or is longer than the 12-hour limit (the server refuses those anyway). Daylight saving is included: 10:00 PM to 6:00 AM on the night the clocks fall back is 9 hours.
- **Time zones:** each shift carries its `timezone`; the page formats times in that zone with `Intl.DateTimeFormat`, not in the viewer's own zone (`js/core/time.js`). A shift belongs to the day it starts in its workplace zone, so a 22:00 shift stays on its own day even though it is already the next day in UTC.
- **Daylight saving:** when a wall-clock time is turned into UTC (`zonedTimeToUtc`, for creating shifts), a time that never happens because clocks spring forward (2:30 on the March change in the US) moves forward by the jump (3:30), and a time that happens twice because clocks fall back (1:30 on the November change) means the first one. These are the "compatible" rules of JavaScript's Temporal API.
- **Addresses:** both pages read `?week=YYYY-MM-DD` (the department week also `&department=<id>`), so a week can be bookmarked or shared. Any day of the week works; without a week, or with a day that does not exist (for example `2026-99-99`), the page shows the current week. Previous and next week links keep the department. **Back to current week** stays visible so the navigation does not move; it is disabled while showing the current week, and otherwise returns directly to the week containing today while keeping the department. A plain click on an enabled week link loads the other week in place (the address changes, Back returns to the week before), so the tabs and the name stay put; while it loads, the old week dims slightly instead of disappearing.
- **Which department:** the department week always shows one department, named in the heading, so shifts of different departments are never mixed. Without `&department=` it shows the person's own department, taken from the loaded session (if the session names none, the company's first department). The heading comes from the departments list, so a week with no shifts is still named. The address only chooses what to look at; the API decides what the person may see.
- **Edit buttons** appear only when the session's permissions include `schedule.edit`; this is a convenience, the API checks every change.
- **Shifts stay short on the week screens:** each shows its time (and, in the department week, who works it), plus a small marker when it has an event (a star) or notes (a page): with the words "Event" and "Notes" on the day cards, icons only in the grid's narrow cells (the words stay for screen readers). Clicking or tapping a shift, or pressing Enter on it, opens a popup with the rest: the day, who, role, department, event, and notes. The popup closes with its Close button or the Escape key, and keyboard focus goes back to the shift (`js/components/shift-dialog.js`).
- **Details, notes, and event text** are shown with `textContent`, never as HTML, in the popup as everywhere else.
- A 409 answer (double booking, time off, a shift that has ended) is shown next to the shift in plain words: in the form or question about that shift, or in the selection bar for a batch. The server's own words are used ("This person already has a shift at that time."), as text. 422 answers (for example "A shift cannot end in the past." or "This person cannot be assigned to this shift.") are shown the same way, and the form or bar stays as it was so nothing typed is lost.
- **Edit mode details** (workforce-ops-app/workforce-ops-frontend#16):
  - **Only what changed is sent.** Changing a shift sends a `PATCH` with just the changed fields (so the audit entry lists exactly those), and an `assign` when the person changed. Emptying a text field sends `null`. These are two requests (the backend changes the person only through `assign`), so if the `PATCH` is saved and the `assign` is refused, the form says "The times and details were saved, but who works the shift was not changed." with the reason, the week behind it loads again, and trying again sends only the `assign`.
  - **One change at a time.** While a change is being sent, the form or question cannot be left (**Go back** is off and Escape is held back) and its buttons are off, and the selection bar's buttons are off until the week has loaded again. Closing the popup at that moment would look like "cancelled" while the server might still save the change. If a browser closes it anyway (Escape pressed twice in a row, which a page may not hold back again), the page still waits for the answer and reloads the week after a saved change.
  - **No answer is not "nothing saved".** When the server cannot be reached, the change may have been saved before the connection failed, so the message says "The server could not be reached, so the change may or may not have been saved. Check the schedule before trying again."
  - **Adding on several days** sends one `POST /api/shifts/batch` with `action: "create"`, so either every day's shift is added or none is. One day sends `POST /api/shifts`.
  - **Times** are typed in the workplace's zone, named under the field. A new shift uses the zone of the week's shifts, else the company's (`currentSession().company.timezone`); the backend copies the department's zone onto the shift either way. An end at or before the start means the shift ends the next day.
  - **Who can be chosen:** the department's people when the server lists them (`GET /api/users`, after workforce-ops-app/workforce-ops-backend#54), plus everyone who worked a shift in the department in the shown week or the three weeks before. Until the people endpoint exists, someone who has never worked in the department cannot be picked yet. The server still checks that the chosen person may work the shift (422 otherwise).
  - **Ended and cancelled shifts** get no select box and no edit buttons; their details say "This shift has ended, so it can no longer be changed." The server refuses them anyway (409).
  - **Permissions:** the Edit week button exists only with `schedule.edit`. A manager whose scope covers only part of the company sees the button for every department, but the server answers 403 outside their scope, shown as "You do not have permission to do this." (threat E8).
  - **Security, in course terms:** every change is a `POST` or `PATCH` with the `X-CSRF-Token` header added by `js/api/client.js` (CSRF); shift IDs are put into addresses with `encodeURIComponent`, so an ID can never change which address is called; every name, role, and note is shown with `textContent` (XSS); the count confirmation is checked by the server, not only asked by the page (decision 0025, threat D3).
