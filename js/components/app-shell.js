// The frame of every signed-in page: who is signed in, the sign-out button, and the main
// menu with only the entries the person may use (docs/architecture/components.md).
//
// Each page script starts with startSignedInPage(showPage): it loads the session first, so
// a signed-out visitor goes straight to the sign-in page, then fills in the frame, then
// shows the page itself.

import { ApiError, NetworkError } from "../api/client.js";
import { el, setText } from "../core/dom.js";
import { can, loadSession, signOut } from "../core/session.js";

/**
 * Show or hide every element marked data-permission="<code>" (menu entries, buttons).
 * They start hidden in the HTML, so nothing appears that the person cannot use, not even
 * for a moment while the session loads. Hiding is a convenience only: the API still checks
 * every request.
 * @param {ParentNode} [root]
 */
export function applyPermissions(root = document) {
  for (const element of root.querySelectorAll("[data-permission]")) {
    if (element instanceof HTMLElement) {
      element.hidden = !can(element.dataset.permission ?? "");
    }
  }
}

/**
 * The person's name and the sign-out button, for the #account spot in the header.
 * @param {import("../core/session.js").SessionInfo} session
 * @param {(path: string) => void} [navigate] where sign-out goes (tests pass a fake)
 * @returns {HTMLElement[]}
 */
export function accountItems(session, navigate) {
  // The name comes from the server and is shown as text, never parsed as HTML (it is a
  // value people choose, so it could contain markup).
  const name = el("span", { className: "account__name", text: session.user.display_name });
  const button = el("button", {
    className: "account__sign-out",
    text: "Sign out",
    attrs: { type: "button" },
  });

  button.addEventListener("click", async () => {
    // One click at a time: a second click while the first is on its way does nothing.
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    button.disabled = true;
    setText(button, "Signing out...");
    try {
      await signOut(navigate);
    } catch (error) {
      // The server could not be reached, or answered with an error: stay on the page, so
      // the person knows they are still signed in and can try again.
      button.disabled = false;
      setText(button, "Sign out");
      if (error instanceof ApiError || error instanceof NetworkError) {
        setText(name, `${session.user.display_name} (sign-out failed, try again)`);
        return;
      }
      // Anything else is a bug in our own code: throw it on to the console.
      throw error;
    }
  });

  return [name, button];
}

/**
 * Load the session, fill in the frame, then show the page.
 *
 * - Signed out (401): the visitor is on the way to the sign-in page; showPage never runs.
 * - The session could not be loaded for another reason (server down, 500): showPage runs
 *   anyway, so the page shows its usual "Problem: ..." message from its own request.
 * - A bug in our own code is thrown on.
 *
 * @param {() => Promise<void>} showPage the page's own loading, e.g. showMyWeek
 * @param {(path: string) => void} [navigate]
 */
export async function startSignedInPage(showPage, navigate) {
  /** @type {import("../core/session.js").SessionInfo | null | undefined} */
  let session;
  try {
    session = await loadSession(navigate);
  } catch (error) {
    if (!(error instanceof ApiError || error instanceof NetworkError)) throw error;
    session = undefined;
  }
  if (session === null) return;

  if (session) {
    const account = document.getElementById("account");
    if (account) {
      account.replaceChildren(...accountItems(session, navigate));
      account.hidden = false;
    }
    applyPermissions();
  }
  await showPage();
}
