// The sign-in page's status check: expected failures get a message; bugs are not hidden.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showApiStatus } from "../../js/pages/sign-in.js";

/** @type {import("vitest").Mock} */
let fetchMock;

beforeEach(() => {
  // A page with the status paragraph the script fills in (built with DOM calls, not HTML).
  const status = document.createElement("p");
  status.id = "api-status";
  document.body.replaceChildren(status);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** The text the page shows. */
function shown() {
  return document.getElementById("api-status")?.textContent;
}

/**
 * A fake JSON answer.
 * @param {number} status
 * @param {string} body
 */
function json(status, body) {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

describe("showApiStatus", () => {
  it("shows the server status", async () => {
    fetchMock.mockResolvedValue(json(200, JSON.stringify({ status: "ok" })));

    await showApiStatus();

    expect(shown()).toBe("Server status: ok");
  });

  it("says the server could not be reached when no answer arrives", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await showApiStatus();

    expect(shown()).toBe("Problem: the server could not be reached");
  });

  it("shows the title of an error answer", async () => {
    fetchMock.mockResolvedValue(json(503, JSON.stringify({ title: "Service Unavailable" })));

    await showApiStatus();

    expect(shown()).toBe("Problem: Service Unavailable");
  });

  it("does not disguise a bug as a network problem", async () => {
    // A successful answer the page cannot use (null instead of an object) makes reading
    // health.status fail: a bug in our code, not an unreachable server. The page says so
    // in general terms and throws the real error on, so it shows in the console.
    fetchMock.mockResolvedValue(json(200, "null"));

    await expect(showApiStatus()).rejects.toThrow(TypeError);
    expect(shown()).toBe("Problem: this page could not load");
  });
});
