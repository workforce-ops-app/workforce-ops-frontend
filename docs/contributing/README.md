# Contributor Documentation: Frontend

**In short:** how to set up and work on the frontend. The shared workflow (issues, branches, PRs, CI) is in the [contributor guide](https://github.com/workforce-ops-app/.github/tree/main/docs/contributing); this page covers what is specific to this repository.

## First-time setup

Needs Node.js 24 and pre-commit ([local setup](https://github.com/workforce-ops-app/.github/blob/main/docs/contributing/local-setup.md)). From this repository's folder:

```
node --version      # v24.x (the version is also in .nvmrc)
npm ci              # installs the exact tool versions from package-lock.json
pre-commit install
```

- **Node.js runs only the development tools** (formatting, linting, type checks, tests); the pages themselves are plain files served by nginx ([decision 0005](https://github.com/workforce-ops-app/.github/blob/main/docs/decisions/0005-frontend-multi-page-vanilla-js.md)).
- **`npm ci`** (not `npm install`) installs exactly what `package-lock.json` lists, so everyone runs the same tool versions. Dependabot proposes updates.
- **Security lint:** ESLint's `no-unsanitized` rule fails the build when data is put into the page as HTML (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`), the most common cause of cross-site scripting. `eval` and similar are also blocked.

## Quick reference

| Task | Command |
|---|---|
| Run all CI checks locally | `python ../.github/scripts/ci_runner.py` |
| Run one check | `python ../.github/scripts/ci_runner.py --only lint` |
| Install git hooks | `pre-commit install` |
| Format everything | `npm run format` |
| Lint JavaScript, CSS, and HTML | `npm run lint` |
| Type check (JSDoc comments, no build step) | `npm run typecheck` |
| Unit tests | `npm test` |

## Conventions specific to this repository

- Each page has its own HTML file, entry module in `js/pages/`, and stylesheet in `css/pages/`.
- Pages never call `fetch` directly; add a function to the matching file in `js/api/`.
- Use `textContent` or the helpers in `js/core/` to show data, never `innerHTML`.
- No inline scripts, `style=` attributes, or `on*=` handlers.
