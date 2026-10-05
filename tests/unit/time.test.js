// Dates and times in the workplace's time zone (js/core/time.js).
import { describe, expect, it } from "vitest";
import {
  addDays,
  dayKey,
  formatDayHeading,
  formatTimeRange,
  mondayOf,
  zonedTimeToUtc,
} from "../../js/core/time.js";

const CHICAGO = "America/Chicago";

describe("dayKey", () => {
  it("gives the calendar day in the workplace zone, not in UTC", () => {
    // 03:00 UTC on October 6 is still the evening of October 5 in Chicago.
    expect(dayKey("2026-10-06T03:00:00Z", CHICAGO)).toBe("2026-10-05");
    expect(dayKey("2026-10-06T03:00:00Z", "UTC")).toBe("2026-10-06");
  });
});

describe("formatTimeRange", () => {
  it("shows a shift's times in its workplace zone", () => {
    // 14:00 to 22:00 UTC is 9:00 to 17:00 in Chicago in October (daylight saving time).
    expect(formatTimeRange("2026-10-05T14:00:00Z", "2026-10-05T22:00:00Z", CHICAGO)).toBe(
      "9:00 AM - 5:00 PM",
    );
  });
});

describe("formatDayHeading", () => {
  it("names the day", () => {
    expect(formatDayHeading("2026-10-05")).toBe("Monday, October 5");
  });
});

describe("addDays and mondayOf", () => {
  it("counts across month ends", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-11-02", -3)).toBe("2026-10-30");
  });

  it("finds the Monday of the week, with Sunday ending the week", () => {
    expect(mondayOf("2026-10-05")).toBe("2026-10-05"); // a Monday
    expect(mondayOf("2026-10-07")).toBe("2026-10-05"); // Wednesday
    expect(mondayOf("2026-10-11")).toBe("2026-10-05"); // Sunday
  });
});

describe("zonedTimeToUtc", () => {
  it("turns a workplace wall-clock time into UTC, following daylight saving", () => {
    // Chicago is 5 hours behind UTC in October and 6 hours behind in December.
    expect(zonedTimeToUtc("2026-10-05", "09:00", CHICAGO)).toBe("2026-10-05T14:00:00.000Z");
    expect(zonedTimeToUtc("2026-12-07", "09:00", CHICAGO)).toBe("2026-12-07T15:00:00.000Z");
  });

  it("round-trips with dayKey and formatTimeRange", () => {
    const start = zonedTimeToUtc("2026-10-05", "22:30", CHICAGO);

    expect(dayKey(start, CHICAGO)).toBe("2026-10-05");
    expect(formatTimeRange(start, start, CHICAGO)).toBe("10:30 PM - 10:30 PM");
  });
});
