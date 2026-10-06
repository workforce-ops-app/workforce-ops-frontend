// Shifts from the API, and the sample data used until the API exists.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SAMPLE_DEPARTMENTS,
  SAMPLE_ME,
  SAMPLE_MY_DEPARTMENT_ID,
  sampleShifts,
} from "../../js/api/sample-shifts.js";
import {
  USE_SAMPLE_DATA,
  fetchShifts,
  listDepartments,
  listShifts,
  myDepartmentId,
} from "../../js/api/shifts.js";
import { addDays, dayKey, mondayOf } from "../../js/core/time.js";

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

describe("fetchShifts (the real API, used once backend SC1 exists)", () => {
  it("asks for the right days, department, and person", async () => {
    fetchMock.mockResolvedValue(page([], null));

    await fetchShifts({ from: "2026-10-05", to: "2026-10-11", departmentId: "d 1", mine: true });

    const url = new URL(fetchMock.mock.calls[0][0], "http://localhost");
    expect(url.pathname).toBe("/api/shifts");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
      department_id: "d 1",
      mine: "true",
    });
  });

  it("follows the pages until next_cursor is null", async () => {
    fetchMock
      .mockResolvedValueOnce(page([{ id: "1" }], "cursor-a"))
      .mockResolvedValueOnce(page([{ id: "2" }], null));

    const shifts = await fetchShifts({ from: "2026-10-05", to: "2026-10-11" });

    expect(shifts.map((s) => s.id)).toEqual(["1", "2"]);
    expect(new URL(fetchMock.mock.calls[1][0], "http://localhost").searchParams.get("cursor")).toBe(
      "cursor-a",
    );
  });
});

describe("sample data (until backend SC1 exists)", () => {
  const monday = mondayOf(dayKey(new Date(), "America/Chicago"));
  const thisWeek = { from: monday, to: addDays(monday, 6) };

  it("is what the screens use for now, without calling the server", async () => {
    expect(USE_SAMPLE_DATA).toBe(true);
    expect((await listShifts(thisWeek)).length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never includes cancelled shifts, and stays in time order", async () => {
    const shifts = await sampleShifts(thisWeek);

    expect(shifts.every((s) => s.status !== "cancelled")).toBe(true);
    expect(shifts.map((s) => s.starts_at)).toEqual([...shifts.map((s) => s.starts_at)].sort());
  });

  it("filters by days, department, and person like the API", async () => {
    const kitchen = await sampleShifts({ ...thisWeek, departmentId: SAMPLE_MY_DEPARTMENT_ID });
    const mine = await sampleShifts({ ...thisWeek, mine: true });
    const nextWeek = await sampleShifts({ from: addDays(monday, 7), to: addDays(monday, 13) });

    expect(kitchen.length).toBeGreaterThan(0);
    expect(kitchen.every((s) => s.department.id === SAMPLE_MY_DEPARTMENT_ID)).toBe(true);
    expect(mine.every((s) => s.employee?.id === SAMPLE_ME.id)).toBe(true);
    expect(nextWeek.every((s) => dayKey(s.starts_at, s.timezone) >= addDays(monday, 7))).toBe(true);
  });

  it("includes an open shift, for the week view to highlight", async () => {
    const shifts = await sampleShifts(thisWeek);

    expect(shifts.some((s) => s.status === "open" && s.employee === null)).toBe(true);
  });
});

describe("sample departments and IDs", () => {
  // A hyphenated UUID with version 7 and the standard variant, as the backend sends.
  const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("give the departments and the signed-in person's own department, without the server", async () => {
    expect(await listDepartments()).toEqual(SAMPLE_DEPARTMENTS);
    expect(await myDepartmentId()).toBe(SAMPLE_MY_DEPARTMENT_ID);
    expect(SAMPLE_DEPARTMENTS.map((d) => d.id)).toContain(SAMPLE_MY_DEPARTMENT_ID);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses IDs shaped like the API's (UUIDv7), each one different", async () => {
    const monday = mondayOf(dayKey(new Date(), "America/Chicago"));
    const shifts = await sampleShifts({ from: monday, to: addDays(monday, 13) });
    const ids = [
      ...shifts.flatMap((s) => [s.id, s.department.id, s.employee?.id ?? s.id]),
      ...SAMPLE_DEPARTMENTS.map((d) => d.id),
    ];

    expect(ids.every((id) => UUID_V7.test(id))).toBe(true);
    expect(new Set(shifts.map((s) => s.id)).size).toBe(shifts.length);
  });
});
