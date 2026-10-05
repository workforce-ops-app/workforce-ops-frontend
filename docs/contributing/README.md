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
- **CSS checks:** Biome (`biome.jsonc`) checks the stylesheets with its recommended rules: unknown properties and units, duplicate properties, invalid values, empty blocks. It is used for CSS only; Prettier formats everything and ESLint checks the JavaScript. Biome replaced stylelint because stylelint's dependencies carried a vulnerable library (issue #24); Biome is a single program with no JavaScript dependencies.

## Quick reference

| Task | Command |
|---|---|
| Run all CI checks locally | `python ../.github/scripts/ci_runner.py` |
| Run one check | `python ../.github/scripts/ci_runner.py --only lint` |
| Install git hooks | `pre-commit install` |
| Format everything | `npm run format` |
| Lint JavaScript (ESLint), CSS (Biome), and HTML (html-validate) | `npm run lint` |
| Type check (JSDoc comments, no build step) | `npm run typecheck` |
| Unit tests | `npm test` |
| Unit tests with coverage (`js/api`, `js/core`, `js/components`) | `npx vitest run --coverage` |
| Install integration-test browsers (first time) | `npx playwright install chromium firefox webkit` |
| Run the nginx/API smoke tests | `npm run test:integration` |

## Run the complete application locally

Docker Desktop must be running. The two repositories keep separate Compose files, so
start the backend first; it creates the shared network that the frontend joins:

```
cd ../workforce-ops-backend
docker compose up --detach --build

cd ../workforce-ops-frontend
docker compose up --detach --build
```

Open `http://localhost:8080`. Both the pages and `/api` use this address; port 8000 is
published for backend troubleshooting, not for browser code. Follow logs with
`docker compose logs --follow` in the relevant repository. Stop the frontend and then
the backend with `docker compose down` in each folder.

The Playwright command creates its own temporary Docker network and API stand-in. It
cleans both up after the tests, so it does not require or modify the local backend stack.

## Conventions specific to this repository

- Each page has its own HTML file, entry module in `js/pages/`, and stylesheet in `css/pages/`.
- Pages never call `fetch` directly; add a function to the matching file in `js/api/`.
- Use `textContent` or the helpers in `js/core/` to show data, never `innerHTML`.
- No inline scripts, `style=` attributes, or `on*=` handlers.
