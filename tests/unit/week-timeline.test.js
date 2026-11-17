// The week timeline and the summary tiles: rows per person (open shifts left to their own
// section), bars placed by their real start and end (overnight shifts cross the day line,
// Sunday nights are cut at the week's end), placed only through CSS custom properties
// (Content Security Policy), text only (threat T5), one day highlighted (today unless the
// mouse or focus is on another), and a table a screen reader can navigate.
import { describe, expect, it } from "vitest";
import { statTile } from "../../js/components/stat-tile.js";
import {
  assignLanes,
  barSpan,
  minutesIntoWeek,
  timelineRows,
  weekTimeline,
} from "../../js/components/week-timeline.js";
import { addDays } from "../../js/core/time.js";

const XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
const MONDAY = "2026-10-05";
const KEYS = Array.from({ length: 7 }, (_, offset) => addDays(MONDAY, offset));

/** Minutes in a day, to write positions as "2 days and 22 hours in". */
const DAY = 24 * 60;

/**
 * A shift in Chicago, 9:00 to 17:00 local time, on the given day.
 * @param {string} day "YYYY-MM-DD"
 * @param {Partial<import("../../js/api/shifts.js").Shift>} [overrides]
 * @returns {import("../../js/api/shifts.js").Shift}
 */
function shiftOn(day, overrides = {}) {
  return {
    id: `s-${day}`,
    department: { id: "d1", name: "Kitchen" },
    employee: { id: "u1", display_name: "Ana Diaz" },
    starts_at: `${day}T14:00:00Z`,
    ends_at: `${day}T22:00:00Z`,
    timezone: "America/Chicago",
    status: "scheduled",
    details: "Prep line",
    notes: null,
    event_name: null,
    event_description: null,
    ...overrides,
  };
}

/**
 * A shift from 22:00 in Chicago (03:00 UTC the next day) to 6:00 the morning after.
 * @param {string} day the day it starts in Chicago, "YYYY-MM-DD"
 * @param {Partial<import("../../js/api/shifts.js").Shift>} [overrides]
 */
function nightShift(day, overrides = {}) {
  const next = addDays(day, 1);
  return shiftOn(day, {
    starts_at: `${next}T03:00:00Z`,
    ends_at: `${next}T11:00:00Z`,
    ...overrides,
  });
}

const BEN = { id: "u2", display_name: "Ben Okafor" };

/**
 * The day keys of the highlighted cells: the header first, then the day bands.
 * @param {HTMLElement} table
 * @returns {(string | undefined)[]}
 */
const highlighted = (table) =>
  [...table.querySelectorAll(".week-timeline__col--active")].map(
    (cell) => /** @type {HTMLElement} */ (cell).dataset.day,
  );

/**
 * A bar's placing, as the script set it: percentages of the week, and the lane.
 * @param {Element | null} bar
 */
const placing = (bar) => {
  const style = /** @type {HTMLElement} */ (bar).style;
  return {
    start: Number(style.getPropertyValue("--bar-start")),
    length: Number(style.getPropertyValue("--bar-length")),
    lane: Number(style.getPropertyValue("--bar-lane")),
  };
};

/**
 * A span for the lane tests: only the start and end matter there.
 * @param {number} start
 * @param {number} end
 */
const span = (start, end) => ({ start, end, startedBefore: false, continuesAfter: false });

describe("timelineRows", () => {
  it("makes one row per person by name, and leaves open shifts out", () => {
    const rows = timelineRows([
      shiftOn("2026-10-05", { employee: BEN }),
      shiftOn("2026-10-06"),
      shiftOn("2026-10-07", { status: "open", employee: null }),
      shiftOn("2026-10-08"),
    ]);

    expect(rows.map((r) => r.label)).toEqual(["Ana Diaz", "Ben Okafor"]);
    expect(rows[0].shifts).toHaveLength(2);
  });
});

describe("minutesIntoWeek and barSpan", () => {
  it("counts wall-clock minutes from Monday 00:00 in the workplace zone", () => {
    // 14:00 UTC is 9:00 in Chicago (daylight time, UTC-5) on Monday.
    expect(minutesIntoWeek("2026-10-05T14:00:00Z", "America/Chicago", MONDAY)).toBe(9 * 60);
    // 03:00 UTC on Tuesday is still 22:00 on Monday in Chicago: it counts as Monday.
    expect(minutesIntoWeek("2026-10-06T03:00:00Z", "America/Chicago", MONDAY)).toBe(22 * 60);
  });

  it("draws an overnight shift across midnight into the next day", () => {
    // Wednesday 22:00 to Thursday 6:00.
    expect(barSpan(nightShift("2026-10-07"), MONDAY)).toEqual({
      start: 2 * DAY + 22 * 60,
      end: 3 * DAY + 6 * 60,
      startedBefore: false,
      continuesAfter: false,
    });
  });

  it("cuts a Sunday night shift at the end of the week and says it continues", () => {
    const result = barSpan(nightShift("2026-10-11"), MONDAY);

    expect(result.start).toBe(6 * DAY + 22 * 60);
    expect(result.end).toBe(7 * DAY);
    expect(result.continuesAfter).toBe(true);
  });

  it("cuts a shift that started the Sunday before at Monday 00:00", () => {
    const result = barSpan(nightShift("2026-10-04"), MONDAY);

    expect(result.start).toBe(0);
    expect(result.end).toBe(6 * 60);
    expect(result.startedBefore).toBe(true);
  });

  it("uses the wall clock on the night the clocks fall back", () => {
    // Chicago, November 1, 2026: 2:00 AM daylight time becomes 1:00 AM standard time.
    // Saturday 22:00 (03:00 UTC) to Sunday 6:00 (12:00 UTC) lasts 9 real hours.
    const result = barSpan(
      shiftOn("2026-10-31", { starts_at: "2026-11-01T03:00:00Z", ends_at: "2026-11-01T12:00:00Z" }),
      "2026-10-26",
    );

    // Drawn from 22:00 to 6:00 on the clock face, the same clock as the day columns.
    expect(result.start).toBe(5 * DAY + 22 * 60);
    expect(result.end).toBe(6 * DAY + 6 * 60);
  });
});

describe("assignLanes", () => {
  it("keeps bars that do not overlap on one lane, back to back included", () => {
    expect(assignLanes([span(0, 60), span(60, 120)])).toEqual({ lanes: [0, 0], count: 1 });
  });

  it("puts an overlapping bar on a lane of its own", () => {
    // The second overlaps the first; the third overlaps the first too, but fits after the
    // second on its lane.
    expect(assignLanes([span(0, 100), span(50, 80), span(90, 120)])).toEqual({
      lanes: [0, 1, 1],
      count: 2,
    });
  });
});

describe("weekTimeline", () => {
  it("has a column per day and a row per person, with their hours", () => {
    const table = weekTimeline(KEYS, [shiftOn("2026-10-05"), shiftOn("2026-10-07")]);

    expect(table.querySelectorAll("thead th[scope=col]")).toHaveLength(9);
    const row = table.querySelector("tbody tr");
    expect(row?.querySelector("th[scope=row]")?.textContent).toBe("Ana Diaz");
    // One track under all seven days.
    expect(row?.querySelector(".week-timeline__track")?.getAttribute("colspan")).toBe("7");
    // Two 8-hour shifts.
    expect(row?.lastElementChild?.textContent).toBe("16");
    expect(row?.querySelectorAll(".timeline-shift")).toHaveLength(2);
  });

  it("places each bar by its start and length, as percentages of the week", () => {
    const table = weekTimeline(KEYS, [shiftOn("2026-10-07")]);

    // Wednesday 9:00 to 17:00: 2 days and 9 hours in, 8 hours long, out of 168 hours.
    const { start, length, lane } = placing(table.querySelector(".week-timeline__bar"));
    expect(start).toBeCloseTo(((2 * 24 + 9) / 168) * 100, 6);
    expect(length).toBeCloseTo((8 / 168) * 100, 6);
    expect(lane).toBe(0);
  });

  it("never puts text into a style: only numbers, through its own custom properties", () => {
    const table = weekTimeline(KEYS, [
      shiftOn("2026-10-05", { employee: { id: "u9", display_name: XSS }, details: XSS }),
    ]);

    // Everything with a style is a bar or a track, holding only numbers in our properties.
    const styled = table.querySelectorAll("[style]");
    expect(styled.length).toBeGreaterThan(0);
    for (const element of styled) {
      const style = /** @type {HTMLElement} */ (element).style;
      for (let index = 0; index < style.length; index += 1) {
        const name = style.item(index);
        expect(name).toMatch(/^--bar-(start|length|lane|lanes)$/);
        expect(style.getPropertyValue(name)).toMatch(/^[0-9.e-]+$/);
      }
    }
  });

  it("shows an overnight shift's time in three lengths, with +1, and says it in words", () => {
    const table = weekTimeline(KEYS, [nightShift("2026-10-05")]);

    const button = table.querySelector("button.timeline-shift");
    // On screen: the time in three lengths (the stylesheet shows the one that fits the
    // bar), each start and end together on one line, then "+1".
    const time = (/** @type {string} */ length) =>
      button?.querySelector(`.timeline-shift__time--${length}`)?.textContent;
    expect(time("full")).toBe("10 PM - 6 AM");
    expect(time("short")).toBe("10p-6a");
    expect(time("start")).toBe("10p");
    expect(button?.querySelector(".timeline-shift__next-day")?.textContent).toBe("+1");
    // None of them is read aloud: screen readers hear the description below instead.
    for (const piece of button?.querySelectorAll(".timeline-shift__time") ?? []) {
      expect(piece.getAttribute("aria-hidden")).toBe("true");
    }
    // Pointing at the bar shows the whole time, for bars too narrow to show it.
    expect(button?.getAttribute("title")).toBe("10 PM - 6 AM (ends the next day)");
    // For screen readers: who, which day, the full time, and that it ends the next day.
    // (The "+1 day" inside is hidden from them; they hear "ends the next day".)
    expect(button?.querySelector(".visually-hidden")?.textContent).toBe(
      "Ana Diaz, Monday, October 5, 10:00 PM - 6:00 AM +1 day (ends the next day)",
    );
  });

  it("marks a Sunday night shift as going on into next week", () => {
    const table = weekTimeline(KEYS, [nightShift("2026-10-11")]);

    const bar = table.querySelector(".week-timeline__bar");
    expect(bar?.classList.contains("week-timeline__bar--continues")).toBe(true);
    expect(bar?.textContent).toContain("(continues into next week)");
    // It ends exactly at the right edge.
    const { start, length } = placing(bar);
    expect(start + length).toBeCloseTo(100, 6);
  });

  it("leaves open shifts out of the timeline (they have their own section)", () => {
    const table = weekTimeline(KEYS, [
      shiftOn("2026-10-05"),
      shiftOn("2026-10-06", { status: "open", employee: null }),
    ]);

    expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(table.querySelectorAll(".timeline-shift")).toHaveLength(1);
  });

  it("highlights today's column and names it for screen readers", () => {
    const table = weekTimeline(KEYS, [shiftOn("2026-10-05")], { today: "2026-10-07" });

    const today = table.querySelector(".week-timeline__day--today");
    expect(today?.textContent).toContain("Wednesday, October 7 (today)");
    // The header and the one row's band, both on today; never a bar.
    expect(highlighted(table)).toEqual(["2026-10-07", "2026-10-07"]);
  });

  it("labels 6 AM, noon, and 6 PM under every day, hidden from screen readers", () => {
    const table = weekTimeline(KEYS, [shiftOn("2026-10-05")]);
    const days = [...table.querySelectorAll("thead th[data-day]")];

    expect(days).toHaveLength(7);
    for (const day of days) {
      const ticks = day.querySelector(".week-timeline__ticks");
      // Each label in order, each with the place (a CSS class) of the line it names.
      expect(
        [...(ticks?.children ?? [])].map((tick) => [tick.textContent, tick.className]),
      ).toEqual([
        ["6a", "week-timeline__tick week-timeline__tick--morning"],
        ["12p", "week-timeline__tick week-timeline__tick--noon"],
        ["6p", "week-timeline__tick week-timeline__tick--evening"],
      ]);
      // A screen reader hears the date only, not "6a 12p 6p" seven times over.
      expect(ticks?.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("moves the highlight to the day under the mouse, and back to today after", () => {
    const table = weekTimeline(KEYS, [shiftOn("2026-10-05")], { today: "2026-10-07" });
    const monday = /** @type {HTMLElement} */ (table.querySelector("button.timeline-shift"));

    // Pointer events bubble from the shift up to the table, like in a browser.
    monday.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(highlighted(table)).toEqual(["2026-10-05", "2026-10-05"]);

    // Pointing at an empty part of the track highlights that day's band.
    table
      .querySelector('.week-timeline__band[data-day="2026-10-09"]')
      ?.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(highlighted(table)).toEqual(["2026-10-09", "2026-10-09"]);

    // The names column is not a day: the highlight goes back to today.
    table.querySelector("tbody th")?.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(highlighted(table)).toEqual(["2026-10-07", "2026-10-07"]);

    monday.dispatchEvent(new Event("pointerover", { bubbles: true }));
    table.dispatchEvent(new Event("pointerleave"));
    expect(highlighted(table)).toEqual(["2026-10-07", "2026-10-07"]);
  });

  it("follows keyboard focus too", () => {
    const table = weekTimeline(KEYS, [shiftOn("2026-10-05")], { today: "2026-10-07" });
    document.body.append(table);

    /** @type {HTMLElement} */ (table.querySelector("button.timeline-shift")).focus();
    expect(highlighted(table)).toEqual(["2026-10-05", "2026-10-05"]);

    // Focus leaving the timeline brings the highlight back to today.
    /** @type {HTMLElement} */ (document.activeElement).blur();
    expect(highlighted(table)).toEqual(["2026-10-07", "2026-10-07"]);
    table.remove();
  });

  it("highlights nothing in a week without today", () => {
    const table = weekTimeline(KEYS, [shiftOn("2026-10-05")], { today: "2026-10-20" });

    expect(highlighted(table)).toEqual([]);
  });

  it("marks a shift with an event or notes, with words for screen readers", () => {
    const table = weekTimeline(KEYS, [
      shiftOn("2026-10-05", { notes: "Bring the keys", event_name: "Inventory" }),
      shiftOn("2026-10-06", { id: "plain" }),
    ]);

    const [marked, plain] = table.querySelectorAll("button.timeline-shift");
    expect(marked.querySelector(".icon--event")).not.toBeNull();
    expect(marked.querySelector(".icon--note")).not.toBeNull();
    // Only icons on screen; the words are for screen readers, never the note itself.
    expect(marked.querySelector(".shift-extras")?.textContent).toBe("EventNotes");
    expect(marked.textContent).not.toContain("Bring the keys");
    expect(plain.querySelector(".shift-extras")).toBeNull();
  });

  it("shows names as text in the bar, and the details as text in the popup", () => {
    const table = weekTimeline(KEYS, [
      shiftOn("2026-10-05", {
        employee: { id: "u9", display_name: XSS },
        details: XSS,
        notes: XSS,
        event_name: XSS,
      }),
    ]);
    document.body.append(table);

    // The row's name and the bar's description are text, never HTML.
    const button = /** @type {HTMLButtonElement} */ (table.querySelector("button.timeline-shift"));
    expect(table.querySelector("img, script")).toBeNull();
    expect(table.querySelector("tbody th")?.textContent).toBe(XSS);
    expect(button.textContent).toContain(XSS);

    // The popup: every detail, as text.
    button.click();
    const popup = document.querySelector("dialog.shift-dialog");
    expect(popup?.querySelector("img, script")).toBeNull();
    expect(popup?.textContent).toContain(XSS);
    popup?.remove();
    table.remove();
  });

  it("says so when nobody is scheduled this week", () => {
    const table = weekTimeline(KEYS, [shiftOn("2026-10-06", { status: "open", employee: null })]);

    expect(table.querySelector(".week-timeline__empty")?.textContent).toBe(
      "Nobody is scheduled this week.",
    );
    expect(table.querySelector(".week-timeline__empty")?.getAttribute("colspan")).toBe("9");
  });
});

describe("statTile", () => {
  it("shows a label and a value, amber only when asked", () => {
    const plain = statTile("Shifts", 9);
    const attention = statTile("Open shifts", 2, { attention: true });

    expect(plain.textContent).toBe("Shifts9");
    expect(plain.classList.contains("stat--attention")).toBe(false);
    expect(attention.classList.contains("stat--attention")).toBe(true);
  });
});
