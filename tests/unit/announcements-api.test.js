// Announcements from the API: the addresses asked for, and the read mark's CSRF token.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCsrfToken } from "../../js/api/client.js";
import { listAnnouncements, markAnnouncementRead } from "../../js/api/announcements.js";

/** @type {import("vitest").Mock} */
let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

/** A fake page of the list answer. */
const listPage = () =>
  new Response(JSON.stringify({ items: [], next_cursor: null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

/** The address of the nth request sent (0 = the first). */
const requested = (/** @type {number} */ n) =>
  new URL(fetchMock.mock.calls[n][0], "http://localhost");

describe("listAnnouncements", () => {
  it("asks for the first page without a cursor", async () => {
    fetchMock.mockResolvedValue(listPage());

    const page = await listAnnouncements({ limit: 3 });

    expect(requested(0).pathname).toBe("/api/announcements");
    expect(requested(0).searchParams.get("limit")).toBe("3");
    expect(requested(0).searchParams.has("cursor")).toBe(false);
    expect(page).toEqual({ items: [], next_cursor: null });
  });

  it("passes the cursor on, escaped, and nothing more when nothing is asked", async () => {
    // A fresh answer for each request: an answer's body can be read only once.
    fetchMock.mockImplementation(async () => listPage());

    await listAnnouncements({ cursor: "a&b=c", limit: 20 });
    await listAnnouncements();

    expect(requested(0).searchParams.get("cursor")).toBe("a&b=c");
    expect(requested(0).searchParams.get("limit")).toBe("20");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/announcements");
  });
});

describe("markAnnouncementRead", () => {
  it("posts to the announcement's read address with the CSRF token", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    setCsrfToken("token-1");

    const result = await markAnnouncementRead("a1");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/announcements/a1/read");
    const options = fetchMock.mock.calls[0][1];
    expect(options.method).toBe("POST");
    expect(options.headers.get("X-CSRF-Token")).toBe("token-1");
    expect(result).toBeNull();
  });

  it("keeps an odd ID inside its part of the address", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await markAnnouncementRead("../shifts?x=1");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/announcements/..%2Fshifts%3Fx%3D1/read");
  });
});
