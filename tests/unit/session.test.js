// The session module: loading "who am I" once, the CSRF token, signed-out visitors,
// permission checks, and signing out.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../../js/api/client.js";

// Replace the server calls, so each test decides what the "server" answers.
vi.mock("../../js/api/sessions.js", () => ({
  getCurrentSession: vi.fn(),
  signOut: vi.fn(),
}));
// Watch the token handed to the API client, but keep the real error classes.
vi.mock("../../js/api/client.js", async (importOriginal) => ({
  ...(await importOriginal()),
  setCsrfToken: vi.fn(),
}));
const { getCurrentSession, signOut: endSession } = await import("../../js/api/sessions.js");
const { setCsrfToken } = await import("../../js/api/client.js");
const { SIGN_IN_PAGE, can, currentSession, forgetSession, loadSession, signOut } =
  await import("../../js/core/session.js");
/** @param {unknown} fn */
const asMock = (fn) => /** @type {import("vitest").Mock} */ (fn);
const fetchSession = asMock(getCurrentSession);
const deleteSession = asMock(endSession);
const tokenSetter = asMock(setCsrfToken);

/** The answer of GET /api/sessions/current for Ana, an employee. */
const ANA = {
  user: { id: "u1", display_name: "Ana Diaz", email: "ana@example.com", department_id: "d1" },
  company: { id: "c1", name: "Northwind", timezone: "America/Chicago" },
  permissions: ["schedule.view", "schedule.view_self"],
  expires_at: "2026-11-10T12:00:00Z",
  csrf_token: "token-123",
};

const unauthorized = () => new ApiError(401, { title: "Unauthorized", status: 401 });

beforeEach(() => {
  // Each test starts as a fresh page: nothing loaded yet.
  forgetSession();
  fetchSession.mockReset();
  deleteSession.mockReset();
  tokenSetter.mockReset();
});

describe("loadSession", () => {
  it("remembers the person and hands the CSRF token to the API client", async () => {
    fetchSession.mockResolvedValue(ANA);

    await expect(loadSession()).resolves.toEqual(ANA);

    expect(currentSession()).toEqual(ANA);
    expect(tokenSetter).toHaveBeenCalledWith("token-123");
  });

  it("asks the server only once per page, however many parts ask", async () => {
    fetchSession.mockResolvedValue(ANA);

    await Promise.all([loadSession(), loadSession(), loadSession()]);

    expect(fetchSession).toHaveBeenCalledTimes(1);
  });

  it("sends a signed-out visitor to the sign-in page", async () => {
    fetchSession.mockRejectedValue(unauthorized());
    const navigate = vi.fn();

    await expect(loadSession(navigate)).resolves.toBeNull();

    expect(navigate).toHaveBeenCalledWith(SIGN_IN_PAGE);
    expect(currentSession()).toBeNull();
    expect(tokenSetter).toHaveBeenLastCalledWith(null);
  });

  it("throws other failures on instead of pretending the person is signed out", async () => {
    fetchSession.mockRejectedValueOnce(new NetworkError(new TypeError("offline")));
    const navigate = vi.fn();

    await expect(loadSession(navigate)).rejects.toBeInstanceOf(NetworkError);
    expect(navigate).not.toHaveBeenCalled();

    // A later call tries again rather than reusing the failure.
    fetchSession.mockResolvedValueOnce(ANA);
    await expect(loadSession(navigate)).resolves.toEqual(ANA);
  });

  it("keeps the session in memory only, never in browser storage", async () => {
    fetchSession.mockResolvedValue(ANA);
    localStorage.clear();
    sessionStorage.clear();

    await loadSession();

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe("can", () => {
  it("answers from the session's permissions", async () => {
    fetchSession.mockResolvedValue(ANA);
    await loadSession();

    expect(can("schedule.view")).toBe(true);
    expect(can("schedule.edit")).toBe(false);
  });

  it("says no to everything before the session has loaded", () => {
    expect(can("schedule.view")).toBe(false);
  });
});

describe("signOut", () => {
  it("ends the session, forgets it, and goes to the sign-in page", async () => {
    fetchSession.mockResolvedValue(ANA);
    await loadSession();
    deleteSession.mockResolvedValue(null);
    const navigate = vi.fn();

    await signOut(navigate);

    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(currentSession()).toBeNull();
    expect(tokenSetter).toHaveBeenLastCalledWith(null);
    expect(navigate).toHaveBeenCalledWith(SIGN_IN_PAGE);
  });

  it("counts a session that had already ended as signed out", async () => {
    deleteSession.mockRejectedValue(unauthorized());
    const navigate = vi.fn();

    await signOut(navigate);

    expect(navigate).toHaveBeenCalledWith(SIGN_IN_PAGE);
  });

  it("stays on the page when signing out failed", async () => {
    fetchSession.mockResolvedValue(ANA);
    await loadSession();
    deleteSession.mockRejectedValue(new NetworkError(new TypeError("offline")));
    const navigate = vi.fn();

    await expect(signOut(navigate)).rejects.toBeInstanceOf(NetworkError);

    expect(navigate).not.toHaveBeenCalled();
    expect(currentSession()).toEqual(ANA);
  });
});
