// Sign-in page. Checks backend availability, validates credentials locally,
// and sends sign-in requests through the API client. Successful authentication
// creates a server-side session and redirects the user to My Shifts.
import { api, ApiError, NetworkError } from "../api/client.js";
import { el, setText } from "../core/dom.js";
import { signIn } from "../api/sessions.js";

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
 * Handle a sign-in form submission.
 * @param {Event} event
 */
export async function handleSignIn(event) {
  event.preventDefault();

  const form = event.currentTarget;

  // Confirm this event came from an actual form.
  if (!(form instanceof HTMLFormElement)) return;

  const emailInput = form.querySelector("#email");
  const passwordInput = form.querySelector("#password");
  const message = document.getElementById("sign-in-message");
  const button = form.querySelector('button[type="submit"]');

  // Confirm all required elements exist and have the right types.
  if (
    !(emailInput instanceof HTMLInputElement) ||
    !(passwordInput instanceof HTMLInputElement) ||
    !(message instanceof HTMLElement) ||
    !(button instanceof HTMLButtonElement)
  ) {
    throw new Error("Sign-in form is missing required elements.");
  }

  // Prevent duplicate requests.
  if (button.disabled) return;

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  // Clear validation errors from previous attempts.
  emailInput.classList.remove("field__input--invalid");
  passwordInput.classList.remove("field__input--invalid");

  emailInput.removeAttribute("aria-invalid");
  passwordInput.removeAttribute("aria-invalid");

  emailInput.removeAttribute("aria-describedby");
  passwordInput.removeAttribute("aria-describedby");

  message.hidden = true;

  let errorMessage = "";

  // Validate the form before contacting the server.
  if (!email) {
    errorMessage = "Please enter your email address.";
    emailInput.classList.add("field__input--invalid");
    emailInput.setAttribute("aria-invalid", "true");
    emailInput.setAttribute("aria-describedby", "sign-in-message");
    emailInput.focus();
  } else if (!emailInput.checkValidity()) {
    errorMessage = "Please enter a valid email address.";
    emailInput.classList.add("field__input--invalid");
    emailInput.setAttribute("aria-invalid", "true");
    emailInput.setAttribute("aria-describedby", "sign-in-message");
    emailInput.focus();
  } else if (!password) {
    errorMessage = "Please enter your password.";
    passwordInput.classList.add("field__input--invalid");
    passwordInput.setAttribute("aria-invalid", "true");
    passwordInput.setAttribute("aria-describedby", "sign-in-message");
    passwordInput.focus();
  }

  if (errorMessage) {
    setText(message, errorMessage);
    message.hidden = false;
    return;
  }

  button.disabled = true;
  button.textContent = "Signing in...";
  message.hidden = true;

  try {
    await signIn(email, password);

    // The browser handles the HttpOnly session cookie.
    window.location.assign("/pages/my-shifts.html");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setText(
        message,
        "Email or password is incorrect. After several failed attempts, sign-in is paused for a while.",
      );
    } else if (error instanceof NetworkError) {
      setText(message, "Unable to reach the server. Please try again.");
    } else {
      setText(message, "Something went wrong. Please try again.");
      console.error("Sign-in failed:", error);
    }

    message.hidden = false;
    button.disabled = false;
    button.textContent = "Sign in";
  }
}

// Check the server once when the page loads, and catch the form's submit. The handler is
// attached here, not with an onsubmit="..." attribute in the HTML: the Content Security
// Policy blocks inline scripts, including event attributes.
showApiStatus();
document.getElementById("sign-in-form")?.addEventListener("submit", handleSignIn);

// Clear errors when the user edits the form.
document.querySelectorAll("#sign-in-form input").forEach((input) => {
  input.addEventListener("input", () => {
    const message = document.getElementById("sign-in-message");
    if (!message) return;

    // A field-specific validation error should only clear when
    // the user edits the field responsible for that error.
    const invalidField = document.querySelector('#sign-in-form input[aria-invalid="true"]');

    if (invalidField && invalidField !== input) return;

    input.classList.remove("field__input--invalid");
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");

    // Authentication errors are not tied to a specific field,
    // so editing either field clears the message.
    message.hidden = true;
  });
});

// Restore the form when returning through the browser's back-forward cache.
window.addEventListener("pageshow", () => {
  const form = document.getElementById("sign-in-form");

  if (!(form instanceof HTMLFormElement)) return;

  const button = form.querySelector('button[type="submit"]');

  if (!(button instanceof HTMLButtonElement)) return;

  button.disabled = false;
  button.textContent = "Sign in";
});
