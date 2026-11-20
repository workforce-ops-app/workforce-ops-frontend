# Announcements

- **Status:** reading is built (slice AN4, workforce-ops-app/workforce-ops-frontend#78) against the agreed API, tested with stubbed answers until the backend's reading slice (AN2, workforce-ops-app/workforce-ops-backend#155) merges; posting, correcting, archiving, and the read list are built (AN5, workforce-ops-app/workforce-ops-frontend#79), using the backend's managing endpoints (AN1, workforce-ops-app/workforce-ops-backend#154) and its list of audiences you may post to (workforce-ops-app/workforce-ops-backend#177)
- **Related:** screens workforce-ops-app/workforce-ops-frontend#65; tracker workforce-ops-app/.github#84; backend: [announcements](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/features/announcements.md)

## In short
Everyone sees the announcements meant for them: the newest few under their week on My week, and all of them on the Announcements page, newest first. Unread ones say "Unread"; opening one shows its message and marks it read. Managers (anyone with `announcement.create`) also post announcements to the teams and departments they manage (owners and administrators to the whole company too), correct or archive them, and see who has read each one. The text is plain text with **bold** as the only formatting, and it is never treated as HTML, so an announcement cannot carry a script to the people who read it (threat T5).

## Screens

| Screen | Page | Who sees it | Phone / desktop |
|---|---|---|---|
| **Announcements**: every announcement meant for you, newest first, 20 at a time, with **Load more announcements** under the list while the server has more. Each is a card: the title (a button that opens and closes the message), an **Unread** label before the title until you open it, and a line with who posted it, who it is for, when, and **Edited** when it was corrected after posting | `pages/announcements.html` | everyone signed in | both; one column of cards |
| **Newest announcements** on the home screen: the newest three, as the same cards, under the week, with **See all announcements** linking to the page above | `pages/my-shifts.html` (My week, where the brand logo leads) | everyone signed in | phone first, like My week |
| **Announcements tab** in the main tabs of every signed-in page | the tab bar | everyone signed in | both |
| **Manage announcements**: **Post an announcement** at the top, **Show archived**, then the announcements you manage, newest first, 20 at a time. Each card shows the title, who it is for, who posted it, when, **Edited**, its message (open, since managers read what they wrote), how many have read it ("12 of 30 read"), and **Who has read it**, **Correct**, and **Archive**. An archived one is greyed with the word **Archived** and keeps only **Who has read it** | `pages/announcements-manage.html`, linked from the Announcements page ("Post and manage announcements") and the home screen's Needs your attention ("Post an announcement", which opens the form at once) | people with `announcement.create` | both |
| **Post an announcement** (a popup): **Audience** (only the ones the server lists for you), **Title** (up to 120 characters), **Message** (up to 4,000, line breaks kept, `**bold**`), and a **Preview** that shows it as readers will, updated as you type. The server's reason (403, 409, 422) is shown inside the form, and what was typed stays | a popup on the same page | people with `announcement.create` | both |
| **Correct the announcement** (a popup): the title and message with the preview; the audience is named but cannot change. Only the fields that changed are sent | a popup on the same page | same | both |
| **Archive this announcement?** (a question): archiving is asked first, since it cannot be undone | a popup on the same page | same | both |
| **Who has read it** (a popup): the read count, then the people in the audience by name, each "Read <when>" or "Not yet", 50 at a time with **Load more people** | a popup on the same page | same | both |

## Server requests used

Through `js/api/announcements.js`:

| Action | Endpoint |
|---|---|
| One page of your announcements, newest first | `GET /api/announcements?limit=20` for the first page, then `&cursor=<next_cursor>` for each further page; the home screen asks for `limit=3` only |
| Mark one read (when it is opened) | `POST /api/announcements/{id}/read` with the `X-CSRF-Token` header; 204, and sending it again changes nothing; 404 when you are not in its audience |
| Where you may post (for the form's Audience list) | `GET /api/announcements/audiences`: `{items: [{type, department_id, team_id, name, department_name}]}`, or 403 without `announcement.create` anywhere |
| Post one | `POST /api/announcements` `{audience_type, department_id or team_id (only the one the type needs), title, body}`: 201 |
| The announcements you manage | `GET /api/announcements/managed?limit=20` (and `&include_archived=true` with Show archived), then `&cursor=<next_cursor>`; each with `read_count` and `audience_count` |
| Correct one | `PATCH /api/announcements/{id}` with only the changed `title` and/or `body`: 200 |
| Archive one | `POST /api/announcements/{id}/archive`: 200 |
| Who has read it | `GET /api/announcements/{id}/reads?limit=50`, then `&cursor=<next_cursor>`: `{items: [{id, display_name, read_at}]}` (`read_at` null: not yet) |

`GET /api/announcements/{id}` (one announcement) is not needed yet: the list already carries everything the cards show.

## The API answer the screens expect

From the backend design, following [0026](https://github.com/workforce-ops-app/.github/blob/main/docs/decisions/0026-api-conventions.md):

```
GET /api/announcements?cursor=&limit=
{ "items": [Announcement, ...], "next_cursor": "..." | null }
```

Each announcement: `id`, `audience` (`type`: `company`, `department`, or `team`, with `department_id`, `department_name`, `team_id`, `team_name`; for a team, `department_id` is null), `title`, `body`, `author` (`id`, `display_name`), `posted_at` and `edited_at` (UTC; `edited_at` null until edited), `archived`, and `read` (true or false). The server sends only the active announcements whose audience includes the signed-in person (threat I9), so the page shows what it is given and filters nothing itself.

## Notes
- **Text rules** (`js/components/announcement-text.js`, the backend design's "Text"): a pair of `**` marks is bold; anything else is shown as typed. The renderer looks for the first `**`, then the next `**` after it, and makes the text between them bold, then carries on after the closing mark. So:
  - a lone `**` (no partner after it) stays `**`;
  - an empty pair `****` stays `****`, since there is nothing to make bold;
  - runs of stars are read two at a time from the left: `***x***` is bold `*x` followed by `*`;
  - a single `*` is never a mark;
  - bold may span a line break.
- **Never HTML** (threat T5): the bold parts are `<strong>` elements made with `el()`, whose text is set with `textContent`; everything else is text nodes. No other element is ever created, and `innerHTML`, `outerHTML`, and `insertAdjacentHTML` are never used (ESLint's `no-unsanitized` refuses them). So `<script>` or `<img src=x onerror=...>` in a title or message is shown as those characters. The Content Security Policy is the second defense: even if markup got in, its event handlers would be refused. The renderer is used for the title as well as the message, so the same rules apply everywhere; names (author, department, team) are plain text through `el()`.
- **Line breaks** stay newline characters inside the text nodes, and the stylesheet shows them with `white-space: pre-line` (no `<br>` elements are needed, so there is nothing but text and `<strong>` to build). `pre-line` also lets long lines wrap; runs of spaces are shown as one, as everywhere on the web. Windows (`\r\n`) and old Mac (`\r`) line endings are turned into `\n` first, so every break looks the same.
- **Opening is reading:** the title is a button inside the card's heading (the usual disclosure pattern: `aria-expanded` says whether the message is open, `aria-controls` names it). The message starts closed. Opening an unread one sends the read mark once; when the server answers, the **Unread** label goes. If the request fails (the server cannot be reached, or answers with an error such as 404), the announcement stays marked unread, the message is still shown, and the next opening tries again. A second click while the mark is on its way sends nothing more; an announcement already read sends nothing.
- **Unread is shown in words**, not only in colour: the **Unread** label is part of the button's name, so screen readers hear "Unread Inventory tonight". The card also gets a green edge on the left.
- **Who, to whom, when:** "From Maria Lopez · To Kitchen department · Mon, Oct 5, 2026, 9:00 AM · Edited". The audience reads "Everyone" for the company, "<name> department", or "<name> team". The time is in the company's (workplace) time zone from the session, as shifts are (decision 0021), so everyone sees the same posting time; it includes the year because an announcement can stay up for longer than a year (`formatMoment` in `js/core/time.js`), and it sits in a `<time datetime>` element. Before the session has loaded, the browser's own zone is used. "Edited" is shown without the edit time, to keep the line short.
- **Headings nest:** on the Announcements page each title is an `h2` under the page's `h1`; on My week the section has its `h2` ("Announcements") and each title is an `h3`.
- **Paging:** 20 per page on the Announcements page. Each further page is loaded only when **Load more announcements** is pressed, so a company with years of announcements never sends them all at once. The button is off (and says "Loading...") while a page loads, so one press sends one request. Keyboard focus then moves to the first new announcement, so a keyboard or screen-reader user carries on where the new ones start. If a further page fails, the list so far stays, the problem is shown in the status line, and the button stays for another try. The home screen asks for the first 3 only and never pages; its link leads to the full list.
- **Status line:** "Loading announcements...", then nothing, or "No announcements yet.", or "Problem: ..." with the server's title or "the server could not be reached", in a polite `aria-live` line, as on the schedule pages. A bug in our own code shows "Problem: this page could not load" (on My week: "announcements could not load") and is thrown on to the console, never disguised as a network problem. On My week the week and the announcements load at the same time, and either one failing leaves the other on screen.
- **The tab needs no permission:** everyone signed in reads the announcements meant for them, so the Announcements tab has no `data-permission` and is not hidden ([session and navigation](../architecture/session-and-navigation.md)).
- **Where on the home screen:** under the week (and its hours), so My week keeps its week at the top on a phone; three cards keep the section short.
- **Archived** announcements are never in the reader's list (the server leaves them out), so the page has no archived state to show.
- **Managing** (AN5, `js/pages/announcements-manage.js`):
  - **The audiences come from the server** (threat E11). The session lists permission names only, not where they apply, and managers cannot read what roles grant, so the form asks `GET /api/announcements/audiences`, which runs the same check posting does for each audience. A Kitchen manager is offered "Kitchen department" and "Weekend Crew team (Kitchen)", never the company. A team is named with its department, since two departments may have teams of the same name. The select's values are the choices' places in that list, not the server's IDs. Without any audience (the request refused, or an empty list), **Post an announcement** stays hidden; managing what exists still works.
  - **The same safe renderer everywhere** (threat T5): titles and messages in the list, the preview, and the read list's heading all go through `announcementText()`, and names through `el()`. The preview is the bold renderer of AN4, so what the manager sees is exactly what readers will see.
  - **Only what changed:** a correction sends only the fields that differ, so the audit log lists just those; a correction that changes nothing sends no request at all.
  - **After every change** the list loads again from the newest, and a line says what happened ("Announcement posted.", "Correction saved.", "Announcement archived."). Show archived also starts the list again. Loads are counted, so an older answer arriving late never adds to a newer list.
  - **Only a convenience** (threat E8): the links to this page are shown only with `announcement.create`, and the page shows the server's 403 if someone opens it without. Every request is checked again by the API.
  - **The form popup** (`js/components/form-dialog.js`) gained a `textarea` field (line breaks kept, only the spaces around the text trimmed, as the server does), a `maxLength` that stops typing at the server's limit, and an optional preview under the fields, built again after every change. Field IDs now start with `form-dialog-field-`, so a field named `title` no longer takes the popup heading's ID (`form-dialog-title`); that had left the Title field without a label and the popup without a name.

## Tests

- `tests/unit/announcement-text.test.js`: pairs, several pairs, a lone `**`, an empty `****`, odd and nested stars, line breaks (also inside bold, and Windows endings), empty values; `<script>`, `<img src=x onerror=alert(1)>` (in plain and in bold parts), and HTML-looking tags all come out as text, with no element but `<strong>` created and no element inside a `<strong>`.
- `tests/unit/announcement-card.test.js`: the heading button, who, to whom, when (Chicago time), "Edited", the "Unread" label in the button's name, the message opening and closing (`aria-expanded`, `aria-controls`), the read mark sent on opening, once, never for one already read, and tried again after a failure; HTML in a title, body, or name shown as text; the audience words; the workplace time zone.
- `tests/unit/announcements-page.test.js`: the first page, Load more with the server's cursor until there is no more, one request per press, focus on the first new one, a failed further page keeping the list, the empty and error states; the home screen asking for 3 and using `h3` headings.
- `tests/unit/announcements-api.test.js`: the addresses (limit, escaped cursor, encoded ID) and the CSRF token on the read mark.
- `tests/integration/announcements.spec.js` (Chromium, Firefox, WebKit, behind nginx and its real policy, with the API answered by `page.route`): bold is a real `<strong>` and line breaks show on screen; `<img src=x onerror=alert(1)>` in a title and body is shown as text with no image element and no dialog; opening an unread one sends one read mark with the CSRF token; Load more adds the next page; My week shows the newest ones and links to the page; and the browser refuses nothing. Checked the other way round too: with the renderer temporarily switched to `innerHTML`, the unit tests above and every one of these browser tests failed (the browsers also reported the policy refusing the injected `onerror` handler).
- `tests/unit/announcements-manage.test.js`: the audience words and POST bodies; the preview (bold as `<strong>`, HTML as text); the message field (line breaks, the limit, the preview updating while typing); a `title` field labelled with the popup still named; the managed list (read counts, archived ones without changes, HTML as text), Show archived, posting hidden without audiences, the list refused; posting to the chosen audience with the exact body, the server's reason kept in the form, `#post` opening the form; a correction sending only what changed (and nothing when nothing changed); archiving only after the question; the read list with "Read <when>", "Not yet", and Load more people.
- `tests/integration/announcements-manage.spec.js` (Chromium, Firefox, WebKit, behind nginx and its real policy): `<img src=x onerror=alert(1)>` in a manager's title and message shows as text in the list, the read list, and the preview, with no image element, no dialog, and nothing refused; the form offers only the server's audiences and posts the exact body with the CSRF token.
- `tests/integration/smoke.spec.js` includes the Announcements and Manage announcements pages among the signed-in pages that send a signed-out visitor to the sign-in page and stay hidden until the session has loaded.
