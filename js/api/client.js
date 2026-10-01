// The one place that talks to the server. Pages never call fetch directly (decision 0005).

/**
 * @typedef {{ location: string, message: string }} FieldError
 * @typedef {{ type?: string, title?: string, status?: number, detail?: string, errors?: FieldError[] }} Problem
 */

/** An error answer from the API, read from its RFC 9457 problem details. */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {Problem} problem
   */
  constructor(status, problem) {
    super(problem.detail || problem.title || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.type = problem.type || "about:blank";
    this.title = problem.title || "Error";
    this.detail = problem.detail || "";
    /** @type {FieldError[]} */
    this.errors = problem.errors || [];
  }
}

/** @type {string | null} */
let csrfToken = null;

/** @type {(() => Promise<boolean>) | null} */
let reauthHandler = null;

/**
 * Remember the CSRF token the API gave at sign-in; it is sent with every request that
 * changes something.
 * @param {string | null} token
 */
export function setCsrfToken(token) {
  csrfToken = token;
}

/**
 * Register what to do when the API asks for the password again (problem type
 * "reauth-required"). The handler shows the password pop-up and resolves to true when
 * the password was accepted.
 * @param {(() => Promise<boolean>) | null} handler
 */
export function onReauthRequired(handler) {
  reauthHandler = handler;
}

/**
 * Send one request to the API and return the parsed JSON answer.
 * @param {"GET" | "POST" | "PUT" | "PATCH" | "DELETE"} method
 * @param {string} path
 * @param {unknown} [body]
 * @returns {Promise<any>}
 */
export async function apiRequest(method, path, body) {
  // Only our own API: a full URL (https://... or //...) would carry the user's session
  // cookie to another site.
  if (!path.startsWith("/api/")) {
    throw new Error("API paths must start with '/api/'");
  }

  const headers = new Headers({ Accept: "application/json" });

  // CSRF protection (threat model S4): requests that change something carry the token the
  // API gave at sign-in. Another site cannot read it, so it cannot forge such a request.
  // GET requests never change anything, so they do not need it.
  if (method !== "GET" && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  // credentials: "same-origin" sends the session cookie, and only to our own address.
  // Kept in a function so the request can be sent a second time after password re-entry.
  const send = () =>
    fetch(path, {
      method,
      credentials: "same-origin",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let response = await send();
  if (response.ok) {
    return readData(response);
  }

  let problem = await readProblem(response);
  // The API asks for the password again before a sensitive action (problem type
  // "reauth-required"). Show the password pop-up and, if it was accepted, send the same
  // request once more. Only once: a second "reauth-required" is thrown, never asked again.
  if (
    response.status === 403 &&
    problem.type === "reauth-required" &&
    reauthHandler &&
    (await reauthHandler())
  ) {
    response = await send();
    if (response.ok) {
      return readData(response);
    }
    problem = await readProblem(response);
  }
  throw new ApiError(response.status, problem);
}

/**
 * The data of a successful answer: its JSON, or null when there is none (204 No Content).
 * @param {Response} response
 * @returns {Promise<any>}
 */
async function readData(response) {
  return response.status === 204 ? null : response.json();
}

/**
 * The problem details of an error answer. Only JSON is read: an HTML error page (for
 * example from a proxy) could contain internal details, so only its status is used.
 * @param {Response} response
 * @returns {Promise<Problem>}
 */
async function readProblem(response) {
  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("json")) {
    return response.json();
  }
  return { title: response.statusText, status: response.status };
}

/** Shortcuts, so pages read like `api.get("/api/shifts")`. */
export const api = {
  /** @param {string} path */
  get: (path) => apiRequest("GET", path),
  /** @param {string} path @param {unknown} [body] */
  post: (path, body) => apiRequest("POST", path, body),
  /** @param {string} path @param {unknown} [body] */
  patch: (path, body) => apiRequest("PATCH", path, body),
  /** @param {string} path */
  delete: (path) => apiRequest("DELETE", path),
};
