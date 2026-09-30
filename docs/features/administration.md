# Administration

- **Status:** planned (core tier)
- **Related:** workforce-ops-app/workforce-ops-frontend#3; backend: [company structure, people, and access](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/features/organization.md), [authorization](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/architecture/authorization.md)

## In short
The screens administrators and owners use to run their company: people and their accounts, departments and teams, roles and who holds them, reporting lines, and the approval requests that need a decision from above. Kept short on purpose; details are added when the screens are built.

## Screens

| Screen | Page | Who sees it | Phone / desktop |
|---|---|---|---|
| **People**: list with search; a person's details, home department, teams, roles, managers and reports; buttons to create a setup or reset link, deactivate, reactivate, unlock, sign out, and edit name or email | `pages/admin-people.html` | `user.view` to see; `user.manage` for the buttons | desktop first |
| **Departments and teams**: create, rename, set a time zone, archive; team members | `pages/admin-structure.html` | `org.manage` | desktop first |
| **Roles**: each role and what it grants; create, change, archive (only where every holder is below you) | `pages/admin-roles.html` | `role.view` to see; `role.manage` to change | desktop first |
| **Give a role**: role and scope (company, department, team, or one person); shows when it will need approval from above | dialog on the People page | `role.assign` | desktop first |
| **Reporting lines**: a person's managers and reports; add or end a line | section of the People page | `reporting_line.manage` | desktop first |
| **Approvals**: requests waiting for me (same-level roles, owner changes, name changes) and requests I made | `pages/approvals.html` | everyone (most people see only their own) | both |
| **Owners**: current owners; propose adding or removing one | section of the Roles page | Owner only | desktop first |

## Server requests used

Through `js/api/users.js`, `js/api/org.js`, `js/api/roles.js`, and `js/api/approvals.js`; the endpoints are listed on the backend [company structure](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/features/organization.md#backend) page:
- people: `/api/users`, `/api/users/{id}/...`, setup and reset links;
- structure: `/api/departments`, `/api/teams`;
- roles and access: `/api/roles`, `/api/role-assignments`, `/api/reporting-lines`, `/api/owners`;
- approvals: `/api/approval-requests`.

## Notes
- **Setup and reset links** are shown once, with a copy button and a reminder to pass them on in person or by text; the page never stores them.
- **Sensitive actions** (admin-level roles, role permissions, reporting lines, owner changes) open the password re-entry pop-up first ([sign in](sign-in.md)).
- When giving a role answers **202**, the dialog says "Sent for approval to …" instead of "Done".
- Buttons are hidden without the permission, and people the user is not above show no action buttons; the API checks everything regardless.
- The Administration menu entry appears only for people with at least one of `user.manage`, `org.manage`, `role.manage`, `role.assign`, or `reporting_line.manage`.
