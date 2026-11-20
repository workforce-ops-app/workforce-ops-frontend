// Shows a new setup or reset link once (docs/features/administration.md, notes; threat S2).
//
// The server keeps only the link's hash, so this is the only time anyone sees it. The
// popup shows it with a copy button and a reminder to hand it over in person or by text
// message. The page never stores it: it lives in this popup, which is removed from the
// page when it closes.

import { el } from "../core/dom.js";
import { dayKey, formatDayHeading, formatTime } from "../core/time.js";
import { createModal } from "./modal.js";

/**
 * @param {import("../api/users.js").NewLink} link
 * @param {{ name: string, zone: string, copy?: (text: string) => Promise<void> }} options
 *   name: whose link it is; zone: the company's time zone, for when it expires
 * @returns {Promise<void>} once the popup is closed
 */
export function showLinkOnce(link, options) {
  const copy = options.copy ?? ((text) => navigator.clipboard.writeText(text));
  return new Promise((resolve) => {
    const modal = createModal({
      className: "edit-dialog",
      labelledBy: "link-dialog-title",
      onClose: () => resolve(),
    });
    const what = link.purpose === "setup" ? "Setup link" : "Password reset link";
    // Read-only and selected on focus, so it can also be copied by hand.
    const field = /** @type {HTMLInputElement} */ (
      el("input", {
        className: "field__input link-dialog__link",
        attrs: { id: "link-dialog-link", type: "text", readonly: "", "aria-label": what },
      })
    );
    field.value = link.link;
    field.addEventListener("focus", () => field.select());

    const status = el("p", { className: "muted", attrs: { role: "status" } });
    const copyButton = el("button", {
      className: "button button--primary",
      text: "Copy link",
      attrs: { type: "button" },
    });
    copyButton.addEventListener("click", async () => {
      try {
        await copy(link.link);
        status.textContent = "Copied.";
      } catch {
        // Some browsers refuse the clipboard (an http address, or a denied permission).
        status.textContent = "Copying is not allowed here: select the link and copy it.";
        field.focus();
      }
    });
    const close = el("button", { className: "button", text: "Done", attrs: { type: "button" } });
    close.addEventListener("click", () => modal.close());

    modal.box.append(
      el("h2", {
        className: "edit-dialog__title",
        text: `${what} for ${options.name}`,
        attrs: { id: "link-dialog-title" },
      }),
      el("p", {
        className: "edit-dialog__lead",
        text:
          "This is the only time the link is shown. Give it to them in person or by text " +
          "message, not by email. It works once, and any earlier link stops working.",
      }),
      el("div", { className: "field" }, [field]),
      el("p", {
        className: "edit-dialog__note",
        text: `It expires ${formatDayHeading(dayKey(link.expires_at, options.zone))} at ${formatTime(link.expires_at, options.zone)}.`,
      }),
      status,
      el("div", { className: "edit-dialog__buttons" }, [close, copyButton]),
    );
    modal.open(copyButton);
  });
}
