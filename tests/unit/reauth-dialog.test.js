// The password re-entry pop-up: what it sends, and what it does on each answer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../../js/api/client.js";
import { askForPassword } from "../../js/components/reauth-dialog.js";

afterEach(() => document.body.replaceChildren());

/** The open pop-up's parts. */
function parts() {
  const box = /** @type {HTMLDialogElement} */ (document.querySelector("dialog.reauth-dialog"));
  return {
    box,
    input: /** @type {HTMLInputElement} */ (box.querySelector("#reauth-password")),
    form: /** @type {HTMLFormElement} */ (box.querySelector("form")),
    message: /** @type {HTMLElement} */ (box.querySelector("#reauth-message")),
    back: /** @type {HTMLButtonElement} */ (box.querySelector('button[type="button"]')),
  };
}

/** Let the pop-up's awaited request settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("askForPassword", () => {
  it("sends the password exactly as typed and resolves true once accepted", async () => {
    const send = vi.fn().mockResolvedValue(null);
    const answer = askForPassword(send);
    const { input, form } = parts();
    expect(input.autocomplete).toBe("current-password");
    input.value = "  correct horse battery staple ";
    form.requestSubmit();
    await expect(answer).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith("  correct horse battery staple ");
    expect(document.querySelector("dialog")).toBeNull(); // closed and removed
  });

  it("stays open with a message when the password is wrong, and can try again", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(403, { title: "Forbidden" }))
      .mockResolvedValueOnce(null);
    const answer = askForPassword(send);
    const { input, form, message } = parts();
    input.value = "wrong";
    form.requestSubmit();
    await settle();
    expect(message.hidden).toBe(false);
    expect(message.textContent).toBe("That password is not right. Please try again.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    input.value = "right";
    form.requestSubmit();
    await expect(answer).resolves.toBe(true);
  });

  it("does not send an empty password", () => {
    const send = vi.fn();
    askForPassword(send);
    const { form, message } = parts();
    form.requestSubmit();
    expect(send).not.toHaveBeenCalled();
    expect(message.textContent).toBe("Please enter your password.");
  });

  it("explains a lost connection and keeps the pop-up open", async () => {
    const send = vi.fn().mockRejectedValue(new NetworkError(new TypeError("offline")));
    askForPassword(send);
    const { input, form, message } = parts();
    input.value = "anything";
    form.requestSubmit();
    await settle();
    expect(message.textContent).toBe("The password could not be checked. Please try again.");
    expect(document.querySelector("dialog")).not.toBeNull();
  });

  it("resolves false when the person goes back, so the action is not repeated", async () => {
    const send = vi.fn();
    const answer = askForPassword(send);
    parts().back.click();
    await expect(answer).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
