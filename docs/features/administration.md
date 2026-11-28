# Administration

- **Status:** the People screen, with giving a role and reporting lines, is built (UI7, #19). Departments and teams, Roles (with owners), and Approvals follow in #20.
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

## People screen (built)

`pages/admin-people.html`, `js/pages/admin-people.js`. The people the user may see on the left (search by any words of the name or email), the chosen person on the right:
- **Details:** email, home department, teams, account status (no password yet, active, deactivated, locked).
- **Account actions** (`user.manage`, and only for people the user is above): change details, setup link (no password yet) or reset link, unlock, sign out everywhere, deactivate (says how many upcoming shifts still need someone else), reactivate. Adding a person asks who they report to (the user by default) and then shows their setup link.
- **Roles** (`role.assign`, people the user is above): each role and where it applies, a Remove button (never for the Owner role, which changes only through the owners), and **Give a role**: the role, then the whole company, one department, one team, or only one person. The answer says "Ana now holds Scheduler." or "Sent for approval to Owen ..." (the request's `reviewers`, backend #168).
- **Reporting lines** (`reporting_line.manage`, people the user is above): who they report to and who reports to them, an End button on each, and Add a manager.
- **Choosing someone** draws their name and facts at once, with "Loading roles and lines..." and no buttons until their roles and lines arrive; answers for someone chosen earlier are thrown away, so a slow answer never shows one person's buttons under another's name. Focus stays on the chosen name in the list (keyboard users keep their place). On phones, where the details are under the list, the page scrolls to them, and **Back to the list** returns to the chosen name.
- **What cannot be loaded is said, not hidden:** a section the user may not see (the API answers 403) is left out; any other failure (no answer, a server error) shows "Their roles could not be loaded ..." in its place (`role="alert"`), and a failed list of roles to give says so where **Give a role** would be.
- **One request per button:** an account button ignores further clicks until its action and its popup have finished (`aria-disabled`), so a double click on Setup link or Reset link makes one link, not two (the second would cancel the first).
- **Who is above whom** comes from the API (`you_are_above` on each person, backend #168), so the page never guesses. Someone not above a person sees why the buttons are missing. Your own entry points to My account.
- Popups: `js/components/form-dialog.js` (a small form whose choices may depend on another field; the server's refusal is shown inside it; an email address that is not one gets "Enter a valid email address.", before sending and in place of the API's pattern message), `js/components/link-dialog.js` (the link shown once), and `confirm-dialog.js` ("Are you sure?" before deactivating, signing out, removing a role, or ending a line).

## Notes
- **Setup and reset links** are shown once, with a copy button and a reminder to pass them on in person or by text; the page never stores them.
- **Sensitive actions** (admin-level roles, role permissions, reporting lines, owner changes) open the password re-entry pop-up first ([sign in](sign-in.md)).
- When giving a role answers **202**, the dialog says "Sent for approval to …" instead of "Done".
- Buttons are hidden without the permission, and people the user is not above show no action buttons; the API checks everything regardless. The `hidden` attribute always wins over a class's `display` (a rule in `css/base/base.css`), so a hidden button such as **Add a person** really disappears.
- **Company logo** (planned, workforce-ops-app/workforce-ops-backend#101): an administrator uploads the logo shown in the header. Until then the demo companies' logos ship with the frontend (#56).
- The Administration menu entry appears only for people with at least one of `user.manage`, `org.manage`, `role.manage`, `role.assign`, or `reporting_line.manage`.
