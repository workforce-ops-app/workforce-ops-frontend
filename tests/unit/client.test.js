// The API client: requests, the CSRF header, errors, and password re-entry.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, apiRequest, onReauthRequired, setCsrfToken } from "../../js/api/client.js";

/**
 * A fake fetch answer.
 * @param {number} status
 * @param {unknown} [body]
 * @param {string} [contentType]
 */
function answer(status, body, contentType = "application/json") {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  return new Response(status === 204 ? null : text, {
    status,
    statusText: { 200: "OK", 204: "No Content", 500: "Internal Server Error" }[status] || "",
    headers: { "Content-Type": contentType },
  });
}

/** @type {import("vitest").Mock} */
let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  setCsrfToken(null);
  onReauthRequired(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The [url, options] of the nth fetch call. */
function call(n = 0) {
  const [url, options] = fetchMock.mock.calls[n];
  return { url, options, headers: new Headers(options.headers) };
}

describe("requests", () => {
  it("sends a GET with the session cookie and no body", async () => {
    fetchMock.mockResolvedValue(answer(200, { status: "ok" }));

    const result = await api.get("/api/health");

    expect(result).toEqual({ status: "ok" });
    const { url, options, headers } = call();
    expect(url).toBe("/api/health");
    expect(options.method).toBe("GET");
    expect(options.credentials).toBe("same-origin");
    expect(options.body).toBeUndefined();
    expect(headers.get("Accept")).toContain("application/json");
  });

  it("sends a JSON body", async () => {
    fetchMock.mockResolvedValue(answer(200, { id: 1 }));

    await api.post("/api/notes", { title: "Hello" });

    const { options, headers } = call();
    expect(options.method).toBe("POST");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({ title: "Hello" });
  });

  it("sends a PATCH with a JSON body", async () => {
    fetchMock.mockResolvedValue(answer(200, { id: 1 }));

    await api.patch("/api/notes/1", { pinned: true });

    expect(call().options.method).toBe("PATCH");
    expect(JSON.parse(call().options.body)).toEqual({ pinned: true });
  });

  it("returns null for 204 No Content", async () => {
    fetchMock.mockResolvedValue(answer(204));

    expect(await api.delete("/api/notes/1")).toBeNull();
  });

  it("refuses paths outside /api/, so credentials never go to another site", async () => {
    await expect(api.get("https://evil.example/api/x")).rejects.toThrow();
    await expect(api.get("//evil.example/api/x")).rejects.toThrow();
    await expect(api.get("/pages/sign-in.html")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("CSRF token (threat model S4)", () => {
  it("is sent on requests that change something", async () => {
    setCsrfToken("token-123");
    // A fresh answer each time: a response body can only be read once.
    fetchMock.mockImplementation(() => Promise.resolve(answer(200, {})));

    for (const method of /** @type {const} */ (["POST", "PUT", "PATCH", "DELETE"])) {
      fetchMock.mockClear();
      await apiRequest(method, "/api/x", method === "DELETE" ? undefined : {});
      expect(call().headers.get("X-CSRF-Token")).toBe("token-123");
    }
  });

  it("is not sent on GET", async () => {
    setCsrfToken("token-123");
    fetchMock.mockResolvedValue(answer(200, {}));

    await api.get("/api/x");

    expect(call().headers.has("X-CSRF-Token")).toBe(false);
  });
});

describe("errors", () => {
  it("turns problem details into an ApiError", async () => {
    fetchMock.mockResolvedValue(
      answer(
        404,
        { type: "about:blank", title: "Not Found", status: 404, detail: "Shift not found" },
        "application/problem+json",
      ),
    );

    const error = await api.get("/api/shifts/9").catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
    expect(error.title).toBe("Not Found");
    expect(error.detail).toBe("Shift not found");
  });

  it("keeps the field errors of a 422", async () => {
    const errors = [{ location: "body.title", message: "Field required" }];
    fetchMock.mockResolvedValue(
      answer(
        422,
        { title: "Unprocessable Content", status: 422, errors },
        "application/problem+json",
      ),
    );

    const error = await api.post("/api/notes", {}).catch((e) => e);

    expect(error.status).toBe(422);
    expect(error.errors).toEqual(errors);
  });

  it("does not show the body of a non-JSON error page", async () => {
    fetchMock.mockResolvedValue(answer(500, "<h1>Stack trace: secret</h1>", "text/html"));

    const error = await api.get("/api/x").catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(error.title).toBe("Internal Server Error");
    expect(error.message).not.toContain("secret");
  });

  it("reports a network failure as an error the page can show", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(api.get("/api/x")).rejects.toThrow();
  });
});

describe("password re-entry", () => {
  const reauth = () =>
    answer(
      403,
      {
        type: "reauth-required",
        title: "Forbidden",
        status: 403,
        detail: "Enter your password again",
      },
      "application/problem+json",
    );

  it("asks for the password and repeats the request once", async () => {
    const handler = vi.fn().mockResolvedValue(true);
    onReauthRequired(handler);
    fetchMock.mockResolvedValueOnce(reauth()).mockResolvedValueOnce(answer(200, { done: true }));

    const result = await api.post("/api/roles/1/archive");

    expect(handler).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ done: true });
  });

  it("gives up when the password is not re-entered", async () => {
    onReauthRequired(vi.fn().mockResolvedValue(false));
    fetchMock.mockResolvedValue(reauth());

    const error = await api.post("/api/roles/1/archive").catch((e) => e);

    expect(error.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never asks twice for the same request", async () => {
    const handler = vi.fn().mockResolvedValue(true);
    onReauthRequired(handler);
    fetchMock.mockImplementation(() => Promise.resolve(reauth()));

    const error = await api.post("/api/roles/1/archive").catch((e) => e);

    expect(error.status).toBe(403);
    expect(handler).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports the second answer when the repeated request also fails", async () => {
    onReauthRequired(vi.fn().mockResolvedValue(true));
    fetchMock
      .mockResolvedValueOnce(reauth())
      .mockResolvedValueOnce(
        answer(
          409,
          { type: "about:blank", title: "Conflict", status: 409, detail: "Already archived" },
          "application/problem+json",
        ),
      );

    const error = await api.post("/api/roles/1/archive").catch((e) => e);

    expect(error.status).toBe(409);
    expect(error.title).toBe("Conflict");
    expect(error.detail).toBe("Already archived");
  });

  it("is not triggered by an ordinary 403", async () => {
    const handler = vi.fn();
    onReauthRequired(handler);
    fetchMock.mockResolvedValue(
      answer(
        403,
        { type: "about:blank", title: "Forbidden", status: 403 },
        "application/problem+json",
      ),
    );

    await api.get("/api/x").catch(() => {});

    expect(handler).not.toHaveBeenCalled();
  });
});
