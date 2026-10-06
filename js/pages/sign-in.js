// Sign-in page. For now it checks that the API answers, which also proves the API client
// (js/api/client.js) and the DOM helpers (js/core/dom.js) work together, and it keeps the
// form from being sent: signing in itself arrives with the sign-in screen (UI2), once the
// server's sign-in (backend S2) exists.
import { api, ApiError, NetworkError } from "../api/client.js";
import { el, setText } from "../core/dom.js";

/**
 * Ask the API for its health and show the result in #api-status.
 * Exported for the tests; the page calls it once when it loads (below).
 */
export async function showApiStatus() {
  // The paragraph that shows the result; nothing to do on a page without it.
  const status = document.getElementById("api-status");
  if (!status) return;

  try {
    // GET /api/health answers {"status": "ok"} while the API is up.
    const health = await api.get("/api/health");
    setText(status, `Server status: ${health.status}`);
  } catch (error) {
    // The two failures a page expects get a plain-language message.
    if (error instanceof ApiError || error instanceof NetworkError) {
      // ApiError: the server answered with an error, so show its title.
      // NetworkError: no answer at all.
      const message = error instanceof ApiError ? error.title : "the server could not be reached";
      status.replaceChildren(el("span", { className: "error", text: `Problem: ${message}` }));
      return;
    }

    // Anything else is a bug in our own code. Tell the user something went wrong, but
    // throw the error on, so it appears in the browser console with its real cause
    // instead of being disguised as a network problem.
    status.replaceChildren(
      el("span", { className: "error", text: "Problem: this page could not load" }),
    );
    throw error;
  }
}

/**
 * Stop the form from being sent and say that signing in is not connected yet.
 * Exported for the tests; the page connects it to the form once when it loads (below).
 * @param {Event} event the form's submit event
 */
export function holdSignIn(event) {
  // Without this, the browser would send the form to the page's own address.
  event.preventDefault();
  const message = document.getElementById("sign-in-message");
  if (!message) return;
  setText(message, "Signing in is not connected yet.");
  message.hidden = false;
}

// Check the server once when the page loads, and catch the form's submit. The handler is
// attached here, not with an onsubmit="..." attribute in the HTML: the Content Security
// Policy blocks inline scripts, including event attributes.
showApiStatus();
document.getElementById("sign-in-form")?.addEventListener("submit", holdSignIn);
