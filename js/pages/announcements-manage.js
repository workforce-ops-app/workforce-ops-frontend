// Manage announcements: post one, see the ones you manage with how many have read them,
// correct or archive them, and see who has read each (frontend docs,
// features/announcements.md, "Managing"; slice AN5).
//
// Who sees it: people whose session includes announcement.create (the link to this page
// is shown only to them). That is a convenience: the API checks every request again (E8),
// so someone who opened this page without the permission gets the server's 403 and sees
// nothing to manage.
//
// The form offers only the audiences the server says the person may post to
// (GET /api/announcements/audiences, which runs the same check posting does), so a manager
// is never offered the whole company or another department (E11). The server still
// checks the audience that is sent.
//
// Everything managers type is shown through announcementText() (bold pairs become
// <strong> elements, everything else text nodes), in the list and in the form's preview,
// so a title or message is never parsed as HTML (stored cross-site scripting, T5).

import {
  archiveAnnouncement,
  editAnnouncement,
  listAudiences,
  listManaged,
  listReaders,
  postAnnouncement,
} from "../api/announcements.js";
import { ApiError, NetworkError } from "../api/client.js";
import { audienceLabel, workplaceTimeZone } from "../components/announcement-card.js";
import { announcementText } from "../components/announcement-text.js";
import { startSignedInPage } from "../components/app-shell.js";
import { confirmChange } from "../components/confirm-dialog.js";
import { openFormDialog } from "../components/form-dialog.js";
import { createModal } from "../components/modal.js";
import { el, setText } from "../core/dom.js";
import { formatMoment } from "../core/time.js";

/** @typedef {import("../api/announcements.js").ManagedAnnouncement} ManagedAnnouncement */
/** @typedef {import("../api/announcements.js").AudienceChoice} AudienceChoice */
/** @typedef {import("../components/form-dialog.js").Values} Values */

/** How many announcements each page of the list holds. */
export const PAGE_SIZE = 20;
/** How many people each page of the read list holds. */
export const READERS_PAGE_SIZE = 50;
/** The server's limits (backend announcements.md, "Text"). */
export const TITLE_MAX = 120;
export const BODY_MAX = 4000;

/**
 * An audience choice in words, for the form's list, e.g. "Weekend Crew team (Kitchen)".
 * @param {AudienceChoice} choice
 * @returns {string}
 */
export function choiceLabel(choice) {
  if (choice.type === "company") return "Everyone in the company";
  if (choice.type === "department") return `${choice.name} department`;
  // A team, with its department, since two departments may have teams of the same name.
  return choice.department_name
    ? `${choice.name} team (${choice.department_name})`
    : `${choice.name} team`;
}

/**
 * The POST body's audience part for a choice: exactly the ID its type needs.
 * @param {AudienceChoice} choice
 * @returns {{ audience_type: string, department_id?: string, team_id?: string }}
 */
export function audienceBody(choice) {
  if (choice.type === "department" && choice.department_id) {
    return { audience_type: "department", department_id: choice.department_id };
  }
  if (choice.type === "team" && choice.team_id) {
    return { audience_type: "team", team_id: choice.team_id };
  }
  return { audience_type: "company" };
}

/**
 * The form's preview: the title and the message as readers will see them, bold included.
 * Built with announcementText(), the same renderer the reading screens use (T5).
 * @param {Values} values
 * @returns {Node[]}
 */
export function previewNodes(values) {
  if (!values.title && !values.body) {
    return [el("p", { className: "field__hint", text: "Nothing to preview yet." })];
  }
  return [
    el("p", { className: "announcement__title announcement-text" }, announcementText(values.title)),
    el("div", { className: "announcement__body announcement-text" }, announcementText(values.body)),
  ];
}

/**
 * "12 of 30 read", from the server's counts (people in the audience now).
 * @param {{ read_count: number, audience_count: number }} item
 * @returns {string}
 */
export function readLine(item) {
  return `${item.read_count} of ${item.audience_count} read`;
}

/**
 * The only fields that differ from the announcement, so an edit sends what changed and
 * the audit log lists just those.
 * @param {ManagedAnnouncement} item
 * @param {Values} values
 * @returns {{ title?: string, body?: string }}
 */
export function changedFields(item, values) {
  /** @type {{ title?: string, body?: string }} */
  const changes = {};
  if (values.title !== item.title) changes.title = values.title;
  if (values.body !== item.body) changes.body = values.body;
  return changes;
}

/**
 * Put a problem in a status line: the two failures a page expects in plain words; returns
 * false for anything else (a bug in our own code), which the caller throws on.
 * @param {HTMLElement} status
 * @param {unknown} error
 * @returns {boolean}
 */
function showProblem(status, error) {
  if (error instanceof ApiError || error instanceof NetworkError) {
    const message = error instanceof ApiError ? error.title : "the server could not be reached";
    status.replaceChildren(el("span", { className: "error", text: `Problem: ${message}` }));
    return true;
  }
  status.replaceChildren(
    el("span", { className: "error", text: "Problem: this page could not load" }),
  );
  return false;
}

/**
 * The title and message fields, shared by posting and correcting.
 * @param {{ title?: string, body?: string }} [current]
 * @returns {import("../components/form-dialog.js").Field[]}
 */
function textFields(current = {}) {
  return [
    {
      name: "title",
      label: "Title",
      type: "text",
      required: true,
      maxLength: TITLE_MAX,
      value: current.title ?? "",
    },
    {
      name: "body",
      label: "Message",
      type: "textarea",
      required: true,
      maxLength: BODY_MAX,
      value: current.body ?? "",
      hint: "Write **like this** for bold. Line breaks are kept.",
    },
  ];
}

/** The preview shown under the fields of both forms. */
const PREVIEW = { label: "Preview", render: previewNodes };

/**
 * Ask for a new announcement and post it. The audience list holds only the choices the
 * server allows.
 * @param {AudienceChoice[]} choices
 * @returns {Promise<ManagedAnnouncement | null>} the new one, or null when the person went back
 */
export function openPostForm(choices) {
  return openFormDialog({
    title: "Post an announcement",
    lead: "It appears at once for everyone in the audience.",
    submitLabel: "Post announcement",
    fields: [
      {
        name: "audience",
        label: "Audience",
        type: "select",
        // The choice's place in the list: the server's IDs never go into the form itself.
        options: choices.map((choice, index) => ({
          value: String(index),
          label: choiceLabel(choice),
        })),
      },
      ...textFields(),
    ],
    preview: PREVIEW,
    run: (values) =>
      postAnnouncement({
        ...audienceBody(choices[Number(values.audience)]),
        title: values.title,
        body: values.body,
      }),
  });
}

/**
 * Ask for a corrected title or message, and send only what changed.
 * @param {ManagedAnnouncement} item
 * @returns {Promise<ManagedAnnouncement | null>} null when the person went back
 */
export function openEditForm(item) {
  return openFormDialog({
    title: "Correct the announcement",
    lead: `To ${audienceLabel(item.audience)}. The audience cannot change; readers see "Edited".`,
    submitLabel: "Save correction",
    fields: textFields(item),
    preview: PREVIEW,
    run: async (values) => {
      const changes = changedFields(item, values);
      // Nothing changed: nothing to send (and nothing for the audit log).
      if (Object.keys(changes).length === 0) return item;
      return editAnnouncement(item.id, changes);
    },
  });
}

/**
 * Ask before archiving, then archive.
 * @param {ManagedAnnouncement} item
 * @returns {Promise<boolean>} true once archived
 */
export function confirmArchive(item) {
  return confirmChange({
    title: "Archive this announcement?",
    message:
      `Readers will no longer see "${item.title}". It stays in this list (with ` +
      `"Show archived") for history, and cannot be changed again.`,
    confirmLabel: "Archive",
    run: () => archiveAnnouncement(item.id),
  });
}

/**
 * Who has read an announcement, in a popup: the people in its audience by name, each
 * "Read <when>" or "Not yet", a page at a time.
 * @param {ManagedAnnouncement} item
 * @param {string} timeZone
 * @returns {Promise<void>} once the first page is shown (or could not load)
 */
export async function openReaders(item, timeZone) {
  const modal = createModal({ className: "edit-dialog", labelledBy: "readers-title" });
  const status = el("p", { className: "status", attrs: { "aria-live": "polite" } });
  const list = el("ul", { className: "readers" });
  const more = /** @type {HTMLButtonElement} */ (
    el("button", { className: "button", text: "Load more people", attrs: { type: "button" } })
  );
  more.hidden = true;
  const close = el("button", { className: "button", text: "Close", attrs: { type: "button" } });
  close.addEventListener("click", () => modal.close());

  modal.box.append(
    el("h2", {
      className: "edit-dialog__title",
      text: "Who has read it",
      attrs: { id: "readers-title" },
    }),
    // The title through the safe renderer too: it is a manager's text.
    el("p", { className: "edit-dialog__lead announcement-text" }, announcementText(item.title)),
    el("p", { className: "readers__count", text: readLine(item) }),
    status,
    list,
    el("div", { className: "edit-dialog__buttons" }, [more, close]),
  );
  modal.open(close);

  /** @type {string | null} where the next page starts, from the server */
  let cursor = null;
  const loadPage = async () => {
    const page = await listReaders(item.id, { cursor, limit: READERS_PAGE_SIZE });
    cursor = page.next_cursor;
    list.append(
      ...page.items.map((reader) =>
        el(
          "li",
          { className: reader.read_at ? "readers__item" : "readers__item readers__item--not-yet" },
          [
            el("span", { className: "readers__name", text: reader.display_name }),
            reader.read_at
              ? el("time", {
                  className: "readers__when",
                  text: `Read ${formatMoment(reader.read_at, timeZone)}`,
                  attrs: { datetime: reader.read_at },
                })
              : el("span", { className: "readers__when", text: "Not yet" }),
          ],
        ),
      ),
    );
    more.hidden = cursor === null;
  };

  try {
    await loadPage();
    setText(status, list.childElementCount === 0 ? "Nobody is in this audience now." : "");
  } catch (error) {
    if (!showProblem(status, error)) throw error;
  }

  more.addEventListener("click", async () => {
    if (more.disabled) return;
    more.disabled = true;
    try {
      await loadPage();
    } catch (error) {
      if (!showProblem(status, error)) throw error;
    } finally {
      more.disabled = false;
    }
  });
}

/**
 * One announcement in the managing list: its title, who it is for and when it was
 * posted, its message, how many have read it, and what can be done with it.
 * @param {ManagedAnnouncement} item
 * @param {{ timeZone: string, onEdit: () => void, onArchive: () => void, onReaders: () => void }} options
 * @returns {HTMLElement}
 */
export function managedCard(item, options) {
  const facts = [
    el("span", { text: `To ${audienceLabel(item.audience)}` }),
    el("span", { text: `From ${item.author.display_name}` }),
    el("time", {
      text: formatMoment(item.posted_at, options.timeZone),
      attrs: { datetime: item.posted_at },
    }),
  ];
  if (item.edited_at) facts.push(el("span", { className: "announcement__edited", text: "Edited" }));

  const buttons = [
    button("Who has read it", options.onReaders),
    // An archived announcement is history: it cannot be changed again (the server says
    // 409), so it has no buttons for that.
    ...(item.archived
      ? []
      : [button("Correct", options.onEdit), button("Archive", options.onArchive)]),
  ];

  return el(
    "article",
    {
      className: item.archived ? "announcement managed managed--archived" : "announcement managed",
    },
    [
      el("h2", { className: "announcement__heading" }, [
        ...(item.archived
          ? [el("span", { className: "managed__archived", text: "Archived" })]
          : []),
        el(
          "span",
          { className: "announcement__title announcement-text" },
          announcementText(item.title),
        ),
      ]),
      el(
        "p",
        { className: "announcement__meta" },
        facts.flatMap((fact, index) =>
          index === 0
            ? [fact]
            : [
                el("span", {
                  className: "announcement__dot",
                  text: " · ",
                  attrs: { "aria-hidden": "true" },
                }),
                fact,
              ],
        ),
      ),
      el("div", { className: "announcement__body announcement-text" }, announcementText(item.body)),
      el("p", { className: "managed__reads", text: readLine(item) }),
      el("div", { className: "managed__actions" }, buttons),
    ],
  );
}

/**
 * A small button that runs an action.
 * @param {string} text
 * @param {() => void} action
 * @returns {HTMLElement}
 */
function button(text, action) {
  const element = el("button", {
    className: "button button--small",
    text,
    attrs: { type: "button" },
  });
  element.addEventListener("click", action);
  return element;
}

/**
 * Load the audiences and the first page of managed announcements, and set up posting,
 * "Show archived", and "Load more". Exported for the tests; the page calls it once the
 * session has loaded.
 * @param {string} [hash] the address's #part: "#post" opens the form at once (the home
 *   screen's "Post an announcement" link)
 */
export async function showManage(hash = window.location.hash) {
  const status = document.getElementById("status");
  const list = document.getElementById("managed");
  const more = document.getElementById("load-more");
  const post = document.getElementById("post");
  const archived = document.getElementById("show-archived");
  const done = document.getElementById("done");
  if (
    !status ||
    !list ||
    !done ||
    !(more instanceof HTMLButtonElement) ||
    !(post instanceof HTMLButtonElement) ||
    !(archived instanceof HTMLInputElement)
  ) {
    return;
  }
  const timeZone = workplaceTimeZone();
  /** @type {string | null} where the next page starts, from the server */
  let cursor = null;
  // Counts the loads, so an older answer arriving late never adds to a newer list.
  let generation = 0;

  /** Ask for one page and add its announcements to the end of the list. */
  const loadPage = async () => {
    const asked = generation;
    const page = await listManaged({ cursor, limit: PAGE_SIZE, includeArchived: archived.checked });
    if (asked !== generation) return;
    cursor = page.next_cursor;
    list.append(
      ...page.items.map((item) =>
        el("li", { className: "announcement-list__item" }, [
          managedCard(item, {
            timeZone,
            onReaders: () => void openReaders(item, timeZone),
            onEdit: () => void act(openEditForm(item), "Correction saved."),
            onArchive: () => void act(confirmArchive(item), "Announcement archived."),
          }),
        ]),
      ),
    );
    more.hidden = cursor === null;
  };

  /** Start the list again from the newest (after a change, or "Show archived"). */
  const reload = async () => {
    generation += 1;
    cursor = null;
    list.replaceChildren();
    more.hidden = true;
    setText(status, "Loading announcements…");
    try {
      await loadPage();
      setText(status, list.childElementCount === 0 ? "No announcements to manage yet." : "");
    } catch (error) {
      if (!showProblem(status, error)) throw error;
    }
  };

  /**
   * After a form or question closes: when it saved something, say so and show the list
   * as the server has it now.
   * @param {Promise<unknown>} asked the form or question
   * @param {string} message e.g. "Announcement posted."
   */
  const act = async (asked, message) => {
    const result = await asked;
    if (!result) return; // went back: nothing changed
    setText(done, message);
    await reload();
  };

  // The audiences and the first page at once.
  /** @type {AudienceChoice[]} */
  let choices = [];
  const [audiences] = await Promise.allSettled([listAudiences(), reload()]);
  if (audiences.status === "fulfilled") {
    choices = audiences.value;
  } else if (!(audiences.reason instanceof ApiError || audiences.reason instanceof NetworkError)) {
    throw audiences.reason;
  }
  // Posting only with somewhere to post to; managing what exists still works without.
  post.hidden = choices.length === 0;
  post.addEventListener("click", () => void act(openPostForm(choices), "Announcement posted."));
  archived.addEventListener("change", () => void reload());
  more.addEventListener("click", async () => {
    if (more.disabled) return;
    more.disabled = true;
    try {
      await loadPage();
    } catch (error) {
      if (!showProblem(status, error)) throw error;
    } finally {
      more.disabled = false;
    }
  });

  // From the home screen's "Post an announcement": open the form straight away.
  if (hash === "#post" && choices.length > 0) post.click();
}

// Once the session has loaded (signed-out visitors go to the sign-in page instead).
startSignedInPage(() => showManage());
