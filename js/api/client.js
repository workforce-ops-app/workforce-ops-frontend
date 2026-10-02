// The one place that talks to the server. Pages never call fetch directly (decision 0005).
//
// Every request goes through apiRequest(): it sends the session cookie only to our own
// server, adds the CSRF token to requests that change something, and turns every
// failure into one of two errors a page can handle:
//   - ApiError:     the server answered with an error (4xx or 5xx)
//   - NetworkError: no answer arrived at all (network down, server not running)
// Anything else that goes wrong is a bug in our own code and is left alone, so it shows
// up as a real error in the browser console instead of being mistaken for one of these.

/**
 * @typedef {{ location: string, message: string }} FieldError
 * @typedef {{ type?: string, title?: string, status?: number, detail?: string,
 *   errors?: FieldError[], error_id?: string, [extra: string]: unknown }} Problem
 */

/** An error answer from the API, read from its RFC 9457 problem details. */
export class ApiError extends Error {
  /**
   * @param {number} status the HTTP status code, e.g. 404
   * @param {Problem} problem the problem details the API sent (or a stand-in)
   * @param {Headers} [headers] the answer's headers
   */
  constructor(status, problem, headers = new Headers()) {
    // The message developers see: the API's explanation, else the status phrase.
    super(problem.detail || problem.title || `Request failed with status ${status}`);
    this.name = "ApiError";

    // The fields pages use most, with safe defaults when the API left one out.
    this.status = status;
    this.type = problem.type || "about:blank";
    this.title = problem.title || "Error";
    this.detail = problem.detail || "";
    /** @type {FieldError[]} the per-field problems of a 422 (invalid input) */
    this.errors = problem.errors || [];

    // The reference number of a 500 (decision 0035). A page can show it, so a user's
    // report can be matched to the server's log line for that error.
    this.errorId = problem.error_id || null;

    // How many seconds to wait before trying again, from a 429's Retry-After header,
    // so a page can say "try again in 30 seconds". Null when the header is missing or
    // not a plain number of seconds.
    const retryAfter = headers.get("Retry-After");
    this.retryAfter = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;

    // Everything else is kept too, so new fields or headers from the API (for example
    // Allow on a 405) reach the page without changing this class.
    this.problem = problem;
    this.headers = headers;
  }
}

/** No answer arrived from the server: the network is down or the server is not running. */
export class NetworkError extends Error {
  /** @param {unknown} cause the browser's original error, kept for the console */
  constructor(cause) {
    super("The server could not be reached", { cause });
    this.name = "NetworkError";
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

  // We always want JSON back.
  const headers = new Headers({ Accept: "application/json" });

  // CSRF protection (threat model S4): requests that change something carry the token the
  // API gave at sign-in. Another site cannot read it, so it cannot forge such a request.
  // GET requests never change anything, so they do not need it.
  if (method !== "GET" && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  // Say the body is JSON only when there is one.
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  // Sends the request. Kept in a function so it can be sent a second time after password
  // re-entry. credentials: "same-origin" sends the session cookie, and only to our own
  // address.
  const send = async () => {
    try {
      return await fetch(path, {
        method,
        credentials: "same-origin",
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      // fetch only rejects when no answer arrived at all; an error status (404, 500)
      // still resolves normally. Give that case its own error type, so pages can tell
      // "the server is unreachable" apart from a bug in our own code.
      throw new NetworkError(error);
    }
  };

  // First attempt: a successful answer is returned as data.
  let response = await send();
  if (response.ok) {
    return readData(response);
  }

  // An error answer: read its problem details.
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

  // Still an error: hand the page everything the API said, including the headers.
  throw new ApiError(response.status, problem, response.headers);
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
 * The problem details of an error answer.
 * @param {Response} response
 * @returns {Promise<Problem>}
 */
async function readProblem(response) {
  // Only the status and its standard text, for answers we cannot or should not read.
  const statusOnly = { title: response.statusText, status: response.status };

  // Only JSON is read: an HTML error page (for example from a proxy) could contain
  // internal details, so only its status is used.
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.includes("json")) {
    return statusOnly;
  }

  try {
    return await response.json();
  } catch {
    // The answer claimed to be JSON but was not (cut off, or from a misconfigured proxy).
    // Keep the status instead of failing with a parsing error, so the page still learns
    // it was, say, a 401 or a 503.
    return statusOnly;
  }
}

/** Shortcuts, so pages read like `api.get("/api/shifts")`. */
export const api = {
  /** @param {string} path */
  get: (path) => apiRequest("GET", path),
  /** @param {string} path @param {unknown} [body] */
  post: (path, body) => apiRequest("POST", path, body),
  /** @param {string} path @param {unknown} [body] */
  put: (path, body) => apiRequest("PUT", path, body),
  /** @param {string} path @param {unknown} [body] */
  patch: (path, body) => apiRequest("PATCH", path, body),
  /** @param {string} path */
  delete: (path) => apiRequest("DELETE", path),
};
