// Shifts, departments, and people from the API: the requests sent and the pages followed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCsrfToken } from "../../js/api/client.js";
import {
  assignShift,
  batchShifts,
  cancelShift,
  createShift,
  listDepartmentPeople,
  listDepartments,
  listShifts,
  updateShift,
} from "../../js/api/shifts.js";

/** @type {import("vitest").Mock} */
let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A fake page of the API's list answer.
 * @param {object[]} items
 * @param {string | null} nextCursor
 */
function page(items, nextCursor) {
  return new Response(JSON.stringify({ items, next_cursor: nextCursor }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** The address of the nth request sent (0 = the first). */
const requested = (/** @type {number} */ n) =>
  new URL(fetchMock.mock.calls[n][0], "http://localhost");

describe("listShifts", () => {
  it("asks the server for the right days, department, and person", async () => {
    fetchMock.mockResolvedValue(page([], null));

    await listShifts({ from: "2026-10-05", to: "2026-10-11", departmentId: "d 1", mine: true });

    const url = requested(0);
    expect(url.pathname).toBe("/api/shifts");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
      department_id: "d 1",
      mine: "true",
    });
  });

  it("leaves out the filters the page did not ask for", async () => {
    fetchMock.mockResolvedValue(page([], null));

    await listShifts({ from: "2026-10-05", to: "2026-10-11" });

    expect(Object.fromEntries(requested(0).searchParams)).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
  });

  it("follows the pages until next_cursor is null", async () => {
    fetchMock
      .mockResolvedValueOnce(page([{ id: "1" }], "cursor-a"))
      .mockResolvedValueOnce(page([{ id: "2" }], null));

    const shifts = await listShifts({ from: "2026-10-05", to: "2026-10-11" });

    expect(shifts.map((s) => s.id)).toEqual(["1", "2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requested(1).searchParams.get("cursor")).toBe("cursor-a");
    // The filters stay on every page.
    expect(requested(1).searchParams.get("from")).toBe("2026-10-05");
  });

  it("passes an error answer on to the page", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ title: "Not Found", status: 404 }), {
        status: 404,
        headers: { "Content-Type": "application/problem+json" },
      }),
    );

    await expect(listShifts({ from: "2026-10-05", to: "2026-10-11" })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("listDepartments", () => {
  it("asks GET /api/departments, without filters, and follows the pages", async () => {
    fetchMock
      .mockResolvedValueOnce(page([{ id: "d1", name: "Front of House" }], "next"))
      .mockResolvedValueOnce(page([{ id: "d2", name: "Kitchen" }], null));

    const departments = await listDepartments();

    expect(departments).toEqual([
      { id: "d1", name: "Front of House" },
      { id: "d2", name: "Kitchen" },
    ]);
    expect(requested(0).pathname).toBe("/api/departments");
    expect(requested(0).search).toBe("");
  });
});

describe("listDepartmentPeople", () => {
  it("asks GET /api/users for one department", async () => {
    fetchMock.mockResolvedValue(page([{ id: "u1", display_name: "Ana Diaz" }], null));

    const people = await listDepartmentPeople("d1");

    expect(people).toEqual([{ id: "u1", display_name: "Ana Diaz" }]);
    expect(requested(0).pathname).toBe("/api/users");
    expect(requested(0).searchParams.get("department_id")).toBe("d1");
  });
});

describe("changing shifts", () => {
  /** A saved shift as the server answers. */
  const ok = () =>
    new Response(JSON.stringify({ id: "s1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  /** The method, path, body, and CSRF header of the nth request. */
  const sent = (/** @type {number} */ n) => {
    const [path, init] = fetchMock.mock.calls[n];
    return {
      method: init.method,
      path,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      csrf: new Headers(init.headers).get("X-CSRF-Token"),
    };
  };

  beforeEach(() => {
    fetchMock.mockImplementation(async () => ok());
    setCsrfToken("token-123");
  });
  afterEach(() => setCsrfToken(null));

  it("sends each change to its own address, with the CSRF token", async () => {
    await createShift({
      department_id: "d1",
      employee_id: null,
      starts_at: "2026-10-05T14:00:00.000Z",
      ends_at: "2026-10-05T22:00:00.000Z",
    });
    await updateShift("s1", { notes: "Bring gloves" });
    await assignShift("s1", "u2");
    await cancelShift("s1");
    await batchShifts({ action: "cancel", shift_ids: ["s1", "s2"] });

    expect([0, 1, 2, 3, 4].map(sent)).toEqual([
      {
        method: "POST",
        path: "/api/shifts",
        body: {
          department_id: "d1",
          employee_id: null,
          starts_at: "2026-10-05T14:00:00.000Z",
          ends_at: "2026-10-05T22:00:00.000Z",
        },
        csrf: "token-123",
      },
      {
        method: "PATCH",
        path: "/api/shifts/s1",
        body: { notes: "Bring gloves" },
        csrf: "token-123",
      },
      {
        method: "POST",
        path: "/api/shifts/s1/assign",
        body: { employee_id: "u2" },
        csrf: "token-123",
      },
      { method: "POST", path: "/api/shifts/s1/cancel", body: undefined, csrf: "token-123" },
      {
        method: "POST",
        path: "/api/shifts/batch",
        body: { action: "cancel", shift_ids: ["s1", "s2"] },
        csrf: "token-123",
      },
    ]);
  });

  it("keeps a shift ID inside its own part of the address", async () => {
    // An ID is never trusted to be a plain UUID: "../" or "?" in it stays part of the ID.
    await cancelShift("../users/u1?x=1");

    expect(sent(0).path).toBe("/api/shifts/..%2Fusers%2Fu1%3Fx%3D1/cancel");
  });
});
