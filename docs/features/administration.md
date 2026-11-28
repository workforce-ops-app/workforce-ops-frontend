# Administration

- **Status:** built. The People screen, with giving a role and reporting lines (UI7, #19); Departments and teams, Roles and owners, and Approvals (UI8, #20).
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
| **Approvals**: requests waiting for me (same-level roles, owner changes, name changes) and requests I made | `pages/admin-approvals.html` | everyone with the Administration entry (most see only their own) | both |
| **Owners**: current owners; propose adding or removing one | section of the Roles page | Owner only | desktop first |

## Server requests used

Through `js/api/users.js`, `js/api/org.js`, `js/api/roles.js`, and `js/api/approvals.js`; the endpoints are listed on the backend [company structure](https://github.com/workforce-ops-app/workforce-ops-backend/blob/main/docs/features/organization.md#backend) page:
- people: `/api/users`, `/api/users/{id}/...`, setup and reset links;
- structure: `/api/departments`, `/api/teams`;
- roles and access: `/api/roles`, `/api/role-assignments`, `/api/reporting-lines`, `/api/owners`;
- approvals: `/api/approval-requests`.

## People screen (built)

`pages/admin-people.html`, `js/pages/admin-people.js`. The people the user may see on the left (search by any words of the name or email), with **Add a person** at the top of that column, above the search and the names (for `user.manage` holders); the chosen person on the right:
- **Details:** email, home department, teams, account status (no password yet, active, deactivated, locked).
- **Account actions** (`user.manage`, and only for people the user is above): change details, setup link (no password yet) or reset link, unlock, sign out everywhere, deactivate (says how many upcoming shifts still need someone else), reactivate. Adding a person asks who they report to (the user by default) and then shows their setup link.
- **Roles** (`role.assign`, people the user is above): each role and where it applies, a Remove button (never for the Owner role, which changes only through the owners), and **Give a role**: the role, then the whole company, one department, one team, or only one person. The answer says "Ana now holds Scheduler." or "Sent for approval to Owen ..." (the request's `reviewers`, backend #168).
- **Reporting lines** (`reporting_line.manage`, people the user is above): who they report to and who reports to them, an End button on each, and Add a manager.
- **Choosing someone** draws their name and facts at once, with "Loading roles and lines..." and no buttons until their roles and lines arrive; answers for someone chosen earlier are thrown away, so a slow answer never shows one person's buttons under another's name. Focus stays on the chosen name in the list (keyboard users keep their place). On phones, where the details are under the list, the page scrolls to them, and **Back to the list** returns to the chosen name.
- **What cannot be loaded is said, not hidden:** a section the user may not see (the API answers 403) is left out; any other failure (no answer, a server error) shows "Their roles could not be loaded ..." in its place (`role="alert"`), and a failed list of roles to give says so where **Give a role** would be.
- **One request per person and action:** an account action ignores further clicks until it and its popup have finished (`aria-disabled`), so a double click on Setup link or Reset link makes one link, not two (the second would cancel the first). The running actions are kept by person ID and action, not on the button, so choosing someone else and coming back (which draws new buttons) does not lift the guard. Setup link and Reset link count as one action.
- **Who is above whom** comes from the API (`you_are_above` on each person, backend #168), so the page never guesses. Someone not above a person sees why the buttons are missing. Your own entry points to My account.
- Popups: `js/components/form-dialog.js` (a small form whose choices may depend on another field; the server's refusal is shown inside it; an email address that is not one gets "Enter a valid email address.", before sending and in place of the API's pattern message), `js/components/link-dialog.js` (the link shown once), and `confirm-dialog.js` ("Are you sure?" before deactivating, signing out, removing a role, or ending a line).

## Departments and teams, Roles and owners, Approvals (built)

A sub-menu under the tab bar links the four administration screens, each shown by the permission it needs (People always; Departments and teams with `org.manage`; Roles and owners with `role.view`; Approvals always). Shared pieces: `js/components/admin-page.js` (the status line, buttons that report a failure there, "A, B and C"), `css/pages/admin.css` (the sub-menu and cards).

- **Departments and teams** (`js/pages/admin-structure.js`): each active department with its time zone (the company's unless set; from the list, backend #170), its teams, and who is in each. With `org.manage`: add, change (name and time zone), and archive a department; add, rename, and archive a team; Members (tick to keep, choose one to add). Archiving a department with people or teams is refused by the API, and the reason is shown.
- **Roles and owners** (`js/pages/admin-roles.js`): every role with what it grants. Change and Archive appear only with `role.manage` and where the API says `you_may_change` (backend #170: above every holder, or an owner; never the Owner role or an archived one); otherwise the card says why. The permission list offers only what the user holds (AZ3); a permission the role grants that they lack is shown ticked and locked. Owners: the list, and for owners (`company.transfer_ownership`) Add an owner and Remove; the answer is "Done" or "Sent for approval to ..." (every other owner must agree).
- **Approvals** (`js/pages/admin-approvals.js`): "Waiting for you" (Approve, Deny) and "Yours" (what became of each; Cancel request on your own pending ones). Each request is one sentence, such as "Ada asks to give Chef the Scheduler role, for the Kitchen department.", from the names the API sends (backend #170). Time-off requests are left out: they are decided on the time-off screens.
- Every change asks "Are you sure?" or opens a form first; changing what a role grants, archiving a role, approving admin-level changes, and owner changes ask for the password again.

## Notes
- **Setup and reset links** are shown once, with a copy button and a reminder to pass them on in person or by text; the page never stores them.
- **Sensitive actions** (admin-level roles, role permissions, reporting lines, owner changes) open the password re-entry pop-up first ([sign in](sign-in.md)).
- When giving a role answers **202**, the dialog says "Sent for approval to …" instead of "Done".
- Buttons are hidden without the permission, and people the user is not above show no action buttons; the API checks everything regardless. The `hidden` attribute always wins over a class's `display` (a rule in `css/base/base.css`), so a hidden button such as **Add a person** really disappears.
- **Company logo** (planned, workforce-ops-app/workforce-ops-backend#101): an administrator uploads the logo shown in the header. Until then the demo companies' logos ship with the frontend (#56).
- The Administration menu entry appears only for people with at least one of `user.manage`, `org.manage`, `role.manage`, `role.assign`, or `reporting_line.manage`.
