// Sign-in page. For now it only checks that the API answers, which also proves the API
// client (js/api/client.js) and the DOM helpers (js/core/dom.js) work together.
import { api, ApiError } from "../api/client.js";
import { el, setText } from "../core/dom.js";

async function showApiStatus() {
  const status = document.getElementById("api-status");
  if (!status) return;
  try {
    const health = await api.get("/api/health");
    setText(status, `Server status: ${health.status}`);
  } catch (error) {
    const message = error instanceof ApiError ? error.title : "the server could not be reached";
    status.replaceChildren(el("span", { className: "error", text: `Problem: ${message}` }));
  }
}

showApiStatus();
