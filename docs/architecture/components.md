# Putting content on the page

**In short:** pages build their content with a few small helpers in `js/core/dom.js` that only ever set text, never HTML. That makes cross-site scripting (a name or a note that runs as code) impossible through normal page code, and a lint rule blocks the unsafe alternatives. Reusable pieces of screen (a shift card, a dialog) go in `js/components/` and use the same helpers.

Decisions: [0005 plain JavaScript, safe DOM helpers](https://github.com/workforce-ops-app/.github/blob/main/docs/decisions/0005-frontend-multi-page-vanilla-js.md) · Threat: T5 in the [threat model](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/security/threat-model.md)

## The helpers

```js
import { el, setText, clear } from "../core/dom.js";

const card = el("article", { className: "shift" }, [
  el("h3", { text: shift.details }),          // text, even if it contains "<script>"
  el("p", { text: shift.notes }),
  el("a", { text: "Open", attrs: { href: `/pages/shift.html?id=${shift.id}` } }),
]);
list.append(card);

setText(status, "Saved");                     // replace an element's content with text
clear(list);                                  // empty an element
```

| Helper | Does | Refuses |
|---|---|---|
| `el(tag, { text, className, attrs }, children)` | creates an element; text through `setText`; string children become text nodes | attributes starting with `on` (any capitalization) and `srcdoc` (an iframe parses it as a whole HTML page), and values starting with `javascript:`, `vbscript:`, or `data:` (with leading spaces, any capitalization): they run code or carry a page of their own |
| `setText(element, value)` | replaces the content with text (`textContent`); `null` and `undefined` become empty | nothing to refuse: text can never become HTML |
| `clear(element)` | removes everything inside | |

## Why not innerHTML

`element.innerHTML = name` hands the string to the browser's HTML parser. If `name` is `<img src=x onerror="...">`, that script runs with the user's session. `textContent` never parses: the same string appears as plain characters. ESLint's `no-unsanitized` rule fails the build on `innerHTML`, `outerHTML`, `insertAdjacentHTML`, and `document.write` with data; `eval` and similar are blocked too.

The strict Content Security Policy (served by nginx) is the second defense: even if HTML got in, inline scripts and event attributes would not run.

## Components

`js/components/` holds reusable pieces of screen as functions that take data and return an element built with `el()`, for example `shiftRow(shift)`. Each comes with its stylesheet in `css/components/`.

| Component | File | Shows |
|---|---|---|
| `shiftRow(shift, { showEmployee })`, `noShiftRow()`, `icon(name)` | `js/components/shift-card.js` | one shift: a round clock icon, the time in its workplace zone, then "role · department" (My week) or "name · role" (department week), event and notes; an open shift gets an amber icon and "Open shift"; every user-written field as text |
| `groupByDay(shifts)`, `dayCard(key, shifts, { showEmployee, today })` | `js/components/day-list.js` | shifts grouped by the day they start in their workplace zone; one card per day with the weekday and date on the left, and that day's shift rows or "No shift"; today's card is marked |
| `weekGrid(keys, shifts, { today })`, `gridRows(shifts)` | `js/components/week-grid.js` | the department week as a `<table>`: one row per person (open shifts first, with an icon), one column per day, each person's hours at the end; today's column highlighted; day headers carry the full date for screen readers, empty cells say "No shift" |
| `statTile(label, value, { attention })` | `js/components/stat-tile.js` | a label over a large number, e.g. "Open shifts 2"; amber with an amber edge when it needs action |
| Forms | `css/components/form.css` | labelled fields (`.field`, `.field__label`, `.field__input`), a form-wide message (`.form__message`), and buttons (`.button`, `.button--primary`) |
| App shell | `css/components/app-shell.css`, in each page's HTML | the brand (an empty, fixed-size logo spot and the application's name) and the main tabs: centered brand and a tab bar fixed to the bottom on phones; one white bar across the top on wider screens, brand on the left and tabs on the right |

## Look and feel

Warm off-white pages, white cards with rounded corners and soft shadows, deep green as the accent, amber only for things that need attention (open shifts), and a serif for page headings. The agreed reference is a phone mockup of the week screen; each page then takes the layout that suits its task (frontend issue #34):

- **My week** (employees, phone first): one card per day, the total hours at the bottom.
- **Department week** (managers, laptop first): the week's numbers as tiles, then a grid with one row per person. Phones get the tiles and a card per day.
- **Sign in**: one centered card with only the form; no tabs, since nobody is signed in yet.

**The logo spot is empty** until a logo is chosen. It keeps its size, so adding an `<img>` inside `.brand__logo` later moves nothing. The application's name next to it is the link's text, so the link always has a name.

- **Colors, type, spacing, shapes, and shadows are tokens** in `css/base/base.css` (`--color-accent`, `--font-heading`, `--radius-card`, ...). Stylesheets use the tokens, never their own color values, so a change of palette is one edit.
- **Icons** are small SVG files in `icons/`, used as a CSS mask (`.icon .icon--clock`) and painted in the current text color, so an icon turns green with its link. This needs no inline styles or scripts, which the Content Security Policy forbids. Icons are decorative (`aria-hidden`); the text beside them carries the meaning.
- **Accessibility (WCAG 2.2 AA, decision 0031):** every text and background pair is at least 4.5:1 (checked; the lowest is muted text on the page at 5.4:1); keyboard focus shows a 3px green ring (`:focus-visible`); controls have visible text labels; each day card is labelled with its full date for screen readers; the main navigation comes before the content. New colors must keep the 4.5:1 minimum.

## Tests

`tests/unit/dom.test.js` feeds an XSS payload through every helper and checks that no `<script>` or `<img>` element appears, that event attributes, `srcdoc`, and `javascript:`, `vbscript:`, and `data:` URLs are refused, and that `null` shows as empty.
