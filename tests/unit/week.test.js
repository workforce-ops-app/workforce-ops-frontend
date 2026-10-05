// The week a page shows, from its address, and the links to other weeks (js/core/week.js),
// plus the day-card time helpers.
import { describe, expect, it } from "vitest";
import {
  formatDayNumber,
  formatWeekdayShort,
  formatWeekRange,
  hoursBetween,
} from "../../js/core/time.js";
import { requestedMonday, today, weekLink } from "../../js/core/week.js";

describe("requestedMonday", () => {
  it("turns any day of a week into its Monday", () => {
    expect(requestedMonday(new URLSearchParams("week=2026-10-07"), "2026-12-01")).toBe(
      "2026-10-05",
    );
  });

  it("falls back to the current week when the value is missing or malformed", () => {
    expect(requestedMonday(new URLSearchParams(""), "2026-10-08")).toBe("2026-10-05");
    expect(requestedMonday(new URLSearchParams("week=<script>"), "2026-10-08")).toBe("2026-10-05");
  });
});

describe("weekLink", () => {
  it("points to the week before or after, keeping other settings", () => {
    const params = new URLSearchParams("week=2026-10-05&department=d1");

    expect(weekLink("2026-10-05", -1, params)).toBe("?week=2026-09-28&department=d1");
    expect(weekLink("2026-10-05", 1, params)).toBe("?week=2026-10-12&department=d1");
  });
});

describe("today", () => {
  it("is a day key", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("day-card time helpers", () => {
  it("formats the parts of a day card and the week range", () => {
    expect(formatWeekdayShort("2026-10-05")).toBe("MON");
    expect(formatDayNumber("2026-10-05")).toBe("5");
    expect(formatWeekRange("2026-09-28")).toBe("Sep 28 to Oct 4");
  });

  it("counts hours between two moments", () => {
    expect(hoursBetween("2026-10-05T14:00:00Z", "2026-10-05T22:00:00Z")).toBe(8);
    expect(hoursBetween("2026-10-05T14:00:00Z", "2026-10-05T21:30:00Z")).toBe(7.5);
  });
});
