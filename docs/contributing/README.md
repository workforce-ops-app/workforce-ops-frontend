# Contributor Documentation: Frontend

**In short:** how to set up and work on the frontend. The shared workflow (issues, branches, PRs, CI) is in the [contributor guide](https://github.com/workforce-ops-app/.github/tree/main/docs/contributing); this page covers what is specific to this repository.

> Pending: setup commands will be added with the application scaffold.

## Quick reference

| Task | Command |
|---|---|
| Run all CI checks locally | `python ../.github/scripts/ci_runner.py` |
| Run one check | `python ../.github/scripts/ci_runner.py --only lint` |
| Install git hooks | `pre-commit install` |

## Conventions specific to this repository

- Each page has its own HTML file, entry module in `js/pages/`, and stylesheet in `css/pages/`.
- Pages never call `fetch` directly; add a function to the matching file in `js/api/`.
- Use `textContent` or the helpers in `js/core/` to show data, never `innerHTML`.
- No inline scripts, `style=` attributes, or `on*=` handlers.
