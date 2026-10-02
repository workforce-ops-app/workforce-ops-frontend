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

`js/components/` holds reusable pieces of screen as functions that take data and return an element built with `el()`, for example `shiftCard(shift)`. Each comes with its stylesheet in `css/components/`. None exist yet; the first arrive with the core screens.

## Tests

`tests/unit/dom.test.js` feeds an XSS payload through every helper and checks that no `<script>` or `<img>` element appears, that event attributes, `srcdoc`, and `javascript:`, `vbscript:`, and `data:` URLs are refused, and that `null` shows as empty.
