// Sign-in page. For now it only checks that the API answers, which also proves the API
// client (js/api/client.js) and the DOM helpers (js/core/dom.js) work together.
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

// Check the server once when the page loads.
showApiStatus();
