// Dates and times in the workplace's time zone (js/core/time.js).
import { describe, expect, it } from "vitest";
import {
  addDays,
  dayKey,
  formatDayHeading,
  formatHours,
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

  // US daylight saving in 2026: clocks spring forward at 2:00 on March 8 (2:00 to 3:00)
  // and fall back at 2:00 on November 1 (back to 1:00). Chicago is 6 hours behind UTC in
  // standard time and 5 in daylight time.
  it("uses the right offset on the day clocks spring forward", () => {
    expect(zonedTimeToUtc("2026-03-08", "01:30", CHICAGO)).toBe("2026-03-08T07:30:00.000Z");
    expect(zonedTimeToUtc("2026-03-08", "03:30", CHICAGO)).toBe("2026-03-08T08:30:00.000Z");
    expect(zonedTimeToUtc("2026-03-08", "09:00", CHICAGO)).toBe("2026-03-08T14:00:00.000Z");
  });

  it("moves a time that never happens (2:30 in spring) forward by the jump", () => {
    // 2:30 does not exist on March 8; it becomes 3:30 daylight time.
    expect(zonedTimeToUtc("2026-03-08", "02:30", CHICAGO)).toBe("2026-03-08T08:30:00.000Z");
  });

  it("uses the right offset on the day clocks fall back", () => {
    expect(zonedTimeToUtc("2026-11-01", "00:30", CHICAGO)).toBe("2026-11-01T05:30:00.000Z");
    expect(zonedTimeToUtc("2026-11-01", "02:30", CHICAGO)).toBe("2026-11-01T08:30:00.000Z");
    expect(zonedTimeToUtc("2026-11-01", "03:00", CHICAGO)).toBe("2026-11-01T09:00:00.000Z");
    expect(zonedTimeToUtc("2026-11-01", "09:00", CHICAGO)).toBe("2026-11-01T15:00:00.000Z");
  });

  it("takes the first of a time that happens twice (1:30 in autumn)", () => {
    // 1:30 happens in daylight time (06:30 UTC), then again an hour later in standard time.
    expect(zonedTimeToUtc("2026-11-01", "01:30", CHICAGO)).toBe("2026-11-01T06:30:00.000Z");
  });

  it("round-trips with dayKey and formatTimeRange", () => {
    const start = zonedTimeToUtc("2026-10-05", "22:30", CHICAGO);

    expect(dayKey(start, CHICAGO)).toBe("2026-10-05");
    expect(formatTimeRange(start, start, CHICAGO)).toBe("10:30 PM - 10:30 PM");
  });
});

describe("formatHours", () => {
  it("says hours the way people do", () => {
    expect(formatHours(1)).toBe("1 hour");
    expect(formatHours(7.5)).toBe("7.5 hours");
    expect(formatHours(24)).toBe("24 hours");
    expect(formatHours(0)).toBe("0 hours");
  });
});
