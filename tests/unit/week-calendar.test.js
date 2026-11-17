// The week calendar, the people's colours, the department picker, and the summary tiles:
// blocks placed by their real start and end in their day's column (only through CSS
// custom properties, for the Content Security Policy), overlapping shifts side by side,
// night shifts cut at midnight into two pieces, a stable colour per person from a fixed
// palette, text only (threat T5), descriptions and tooltips with the whole time, edit
// mode's select boxes on the blocks, and a picker that is hidden when there is no choice.
import { afterEach, describe, expect, it, vi } from "vitest";

// Edit mode asks the session what the person may do; each test that needs it says so.
vi.mock("../../js/core/session.js", () => ({ can: vi.fn(), currentSession: vi.fn() }));
const { can } = await import("../../js/core/session.js");
const { statTile } = await import("../../js/components/stat-tile.js");
const { weekEditor } = await import("../../js/components/week-editor.js");
const { CHOOSE, followDepartmentPicker, showDepartmentPicker } =
  await import("../../js/components/department-picker.js");
const { PERSON_COLOURS, personColourClass, personColourIndex } =
  await import("../../js/components/person-colour.js");
const {
  assignColumns,
  assignLanes,
  dayPieces,
  firstHour,
  minutesIntoWeek,
  openAtFirstShift,
  weekCalendar,
  weekSpan,
} = await import("../../js/components/week-calendar.js");
const { addDays } = await import("../../js/core/time.js");

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
    id: `night-${day}`,
    starts_at: `${next}T03:00:00Z`,
    ends_at: `${next}T11:00:00Z`,
    ...overrides,
  });
}

const BEN = { id: "u2", display_name: "Ben Okafor" };
const CARA = { id: "u3", display_name: "Cara Lee" };

/**
 * A block's placing, as the script set it: percentages of the day, and its column.
 * @param {Element | null} block
 */
const placing = (block) => {
  const style = /** @type {HTMLElement} */ (block).style;
  return {
    start: Number(style.getPropertyValue("--block-start")),
    length: Number(style.getPropertyValue("--block-length")),
    column: Number(style.getPropertyValue("--block-column")),
    columns: Number(style.getPropertyValue("--block-columns")),
  };
};

/**
 * The blocks in one day's column.
 * @param {HTMLElement} calendar
 * @param {string} key "YYYY-MM-DD"
 */
const blocksOn = (calendar, key) => [
  ...calendar.querySelectorAll(`.week-calendar__day[data-day="${key}"] .week-calendar__block`),
];

/**
 * A span for the column tests: only the start and end matter there.
 * @param {number} start
 * @param {number} end
 */
const span = (start, end) => ({ start, end });

afterEach(() => document.body.replaceChildren());

describe("minutesIntoWeek and weekSpan", () => {
  it("counts wall-clock minutes from Monday 00:00 in the workplace zone", () => {
    // 14:00 UTC is 9:00 in Chicago (daylight time, UTC-5) on Monday.
    expect(minutesIntoWeek("2026-10-05T14:00:00Z", "America/Chicago", MONDAY)).toBe(9 * 60);
    // 03:00 UTC on Tuesday is still 22:00 on Monday in Chicago: it counts as Monday.
    expect(minutesIntoWeek("2026-10-06T03:00:00Z", "America/Chicago", MONDAY)).toBe(22 * 60);
  });

  it("cuts a Sunday night shift at the end of the week and says it continues", () => {
    const result = weekSpan(nightShift("2026-10-11"), MONDAY);

    expect(result.start).toBe(6 * DAY + 22 * 60);
    expect(result.end).toBe(7 * DAY);
    expect(result.continuesAfter).toBe(true);
  });

  it("uses the wall clock on the night the clocks fall back", () => {
    // Chicago, November 1, 2026: 2:00 AM daylight time becomes 1:00 AM standard time.
    // Saturday 22:00 (03:00 UTC) to Sunday 6:00 (12:00 UTC) lasts 9 real hours.
    const result = weekSpan(
      shiftOn("2026-10-31", { starts_at: "2026-11-01T03:00:00Z", ends_at: "2026-11-01T12:00:00Z" }),
      "2026-10-26",
    );

    // Drawn from 22:00 to 6:00 on the clock face, the same clock as the hour labels.
    expect(result.start).toBe(5 * DAY + 22 * 60);
    expect(result.end).toBe(6 * DAY + 6 * 60);
  });
});

describe("dayPieces", () => {
  it("keeps a day shift in one piece", () => {
    expect(dayPieces(weekSpan(shiftOn("2026-10-07"), MONDAY))).toEqual([
      { day: 2, start: 9 * 60, end: 17 * 60, first: true, continued: false, continues: false },
    ]);
  });

  it("cuts a night shift at midnight into two pieces, each marked as continuing", () => {
    // Wednesday 22:00 to Thursday 6:00.
    expect(dayPieces(weekSpan(nightShift("2026-10-07"), MONDAY))).toEqual([
      { day: 2, start: 22 * 60, end: DAY, first: true, continued: false, continues: true },
      { day: 3, start: 0, end: 6 * 60, first: false, continued: true, continues: false },
    ]);
  });

  it("does not make a piece for a shift that ends exactly at midnight", () => {
    const pieces = dayPieces({
      start: 16 * 60,
      end: DAY,
      startedBefore: false,
      continuesAfter: false,
    });

    expect(pieces).toHaveLength(1);
    expect(pieces[0].continues).toBe(false);
  });

  it("keeps a Sunday night shift to one piece that goes on into next week", () => {
    expect(dayPieces(weekSpan(nightShift("2026-10-11"), MONDAY))).toEqual([
      { day: 6, start: 22 * 60, end: DAY, first: true, continued: false, continues: true },
    ]);
  });

  it("marks a shift from the Sunday before as continued at Monday 00:00", () => {
    expect(dayPieces(weekSpan(nightShift("2026-10-04"), MONDAY))).toEqual([
      { day: 0, start: 0, end: 6 * 60, first: true, continued: true, continues: false },
    ]);
  });
});

describe("assignLanes and assignColumns", () => {
  it("keeps items that do not overlap in one lane, back to back included", () => {
    expect(assignLanes([span(0, 60), span(60, 120)])).toEqual({ lanes: [0, 0], count: 1 });
  });

  it("puts overlapping blocks side by side, and lets a later block reuse a free column", () => {
    // The first runs all morning; the second overlaps it; the third starts after the
    // second has ended, so it takes the second's column again.
    expect(assignColumns([span(0, 300), span(60, 120), span(180, 240)])).toEqual({
      columns: [0, 1, 1],
      counts: [2, 2, 2],
    });
  });

  it("gives a block that overlaps nothing the whole day, even on a crowded day", () => {
    // Three shifts at once in the morning, one alone in the evening.
    expect(
      assignColumns([span(540, 1020), span(600, 900), span(660, 780), span(1080, 1320)]),
    ).toEqual({ columns: [0, 1, 2, 0], counts: [3, 3, 3, 1] });
  });

  it("works whatever order the blocks come in", () => {
    expect(assignColumns([span(600, 700), span(500, 650)])).toEqual({
      columns: [1, 0],
      counts: [2, 2],
    });
  });
});

describe("firstHour", () => {
  it("opens at the hour of the week's earliest start, ignoring the morning of a night shift", () => {
    const pieces = [
      ...dayPieces(weekSpan(nightShift("2026-10-05"), MONDAY)),
      ...dayPieces(weekSpan(shiftOn("2026-10-08", { starts_at: "2026-10-08T12:30:00Z" }), MONDAY)),
    ];

    // Thursday 7:30 is the earliest real start; Tuesday's 0:00 is only the night going on.
    expect(firstHour(pieces)).toBe(7);
  });

  it("opens at 6 AM in a week without shifts", () => {
    expect(firstHour([])).toBe(6);
  });
});

describe("person colours", () => {
  it("gives the same person the same colour every time, from the palette only", () => {
    expect(personColourIndex("u1")).toBe(personColourIndex("u1"));
    expect(personColourClass("u1")).toBe(personColourClass("u1"));
    for (const id of ["u1", "u2", "", "9f1c2e4a-0000-4000-8000-000000000000", XSS]) {
      const index = personColourIndex(id);
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(PERSON_COLOURS);
      // The class is made from the number only, never from the ID's text.
      expect(personColourClass(id)).toMatch(/^person-colour-(\d|1[01])$/);
    }
  });

  it("spreads many people over the whole palette", () => {
    const used = new Set(Array.from({ length: 200 }, (_, n) => personColourIndex(`user-${n}`)));
    expect(used.size).toBe(PERSON_COLOURS);
  });
});

describe("weekCalendar", () => {
  it("has a column per day, labelled for screen readers, and today marked", () => {
    const calendar = weekCalendar(KEYS, [shiftOn("2026-10-05")], { today: "2026-10-07" });

    const days = [...calendar.querySelectorAll("ul.week-calendar__day")];
    expect(days).toHaveLength(7);
    expect(days[0].getAttribute("aria-label")).toBe("Monday, October 5");
    expect(days[2].getAttribute("aria-label")).toBe("Wednesday, October 7 (today)");
    expect(days[2].classList.contains("week-calendar__day--today")).toBe(true);
    expect(
      calendar.querySelector(".week-calendar__day-head--today")?.getAttribute("data-day"),
    ).toBe("2026-10-07");
    // The visible headers and hour labels are only a picture: hidden from screen readers.
    for (const head of calendar.querySelectorAll(".week-calendar__day-head")) {
      expect(head.getAttribute("aria-hidden")).toBe("true");
    }
    expect(calendar.querySelector(".week-calendar__hours")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("labels all 24 hours down the side", () => {
    const calendar = weekCalendar(KEYS, []);
    const hours = [...calendar.querySelectorAll(".week-calendar__hour")].map((h) => h.textContent);

    expect(hours).toHaveLength(24);
    expect(hours.slice(0, 2)).toEqual(["12 AM", "1 AM"]);
    expect(hours[12]).toBe("12 PM");
    expect(hours[23]).toBe("11 PM");
  });

  it("places a block in its day by its start and length, as percentages of the day", () => {
    const calendar = weekCalendar(KEYS, [shiftOn("2026-10-07")]);

    // Wednesday 9:00 to 17:00: 9 of 24 hours down, 8 hours long, the whole width.
    const blocks = blocksOn(calendar, "2026-10-07");
    expect(blocks).toHaveLength(1);
    const { start, length, column, columns } = placing(blocks[0]);
    expect(start).toBeCloseTo((9 / 24) * 100, 6);
    expect(length).toBeCloseTo((8 / 24) * 100, 6);
    expect([column, columns]).toEqual([0, 1]);
  });

  it("puts overlapping shifts on the same day side by side", () => {
    const calendar = weekCalendar(KEYS, [
      shiftOn("2026-10-05"),
      // Ben: 11:00 to 19:00, overlapping Ana's 9:00 to 17:00.
      shiftOn("2026-10-05", {
        id: "ben",
        employee: BEN,
        starts_at: "2026-10-05T16:00:00Z",
        ends_at: "2026-10-06T00:00:00Z",
      }),
      // Cara, on Tuesday, alone.
      shiftOn("2026-10-06", { employee: CARA }),
    ]);

    const monday = blocksOn(calendar, "2026-10-05").map(placing);
    expect(monday.map(({ column, columns }) => [column, columns])).toEqual([
      [0, 2],
      [1, 2],
    ]);
    expect(placing(blocksOn(calendar, "2026-10-06")[0]).columns).toBe(1);
  });

  it("draws a night shift in two pieces, the second an echo screen readers skip", () => {
    const calendar = weekCalendar(KEYS, [nightShift("2026-10-05")]);

    const [evening] = blocksOn(calendar, "2026-10-05");
    const [morning] = blocksOn(calendar, "2026-10-06");
    // Monday 22:00 to midnight, then Tuesday midnight to 6:00.
    expect(placing(evening).start).toBeCloseTo((22 / 24) * 100, 6);
    expect(placing(evening).length).toBeCloseTo((2 / 24) * 100, 6);
    expect(placing(morning).start).toBe(0);
    expect(placing(morning).length).toBeCloseTo((6 / 24) * 100, 6);
    // Each marked as continuing where it is cut.
    expect(evening.classList.contains("week-calendar__block--continues")).toBe(true);
    expect(morning.classList.contains("week-calendar__block--continued")).toBe(true);
    // The first piece is the real button; the second is not a button and is hidden from
    // screen readers, who hear the whole shift once.
    expect(evening.querySelector("button.calendar-shift")).not.toBeNull();
    expect(morning.querySelector("button")).toBeNull();
    expect(morning.getAttribute("aria-hidden")).toBe("true");
    // On screen: the evening piece has the whole time and "+1", the morning "until 6 AM".
    expect(evening.querySelector(".calendar-shift__time--full")?.textContent).toBe("10 PM - 6 AM");
    expect(evening.querySelector(".calendar-shift__next-day")?.textContent).toBe("+1");
    expect(morning.querySelector(".calendar-shift__time--full")?.textContent).toBe("until 6 AM");
    expect(morning.querySelector(".calendar-shift__time--short")?.textContent).toBe("until 6a");
  });

  it("opens the details from the echo, and gives focus back to the real button", () => {
    const calendar = weekCalendar(KEYS, [nightShift("2026-10-05")]);
    document.body.append(calendar);

    const morning = /** @type {HTMLElement} */ (
      blocksOn(calendar, "2026-10-06")[0].querySelector(".calendar-shift")
    );
    morning.click();
    const popup = document.querySelector("dialog.shift-dialog");
    expect(popup?.textContent).toContain("Ana Diaz");
    popup?.dispatchEvent(new Event("close"));
    expect(document.activeElement).toBe(calendar.querySelector("button.calendar-shift"));
  });

  it("marks a Sunday night shift as going on into next week", () => {
    const calendar = weekCalendar(KEYS, [nightShift("2026-10-11")]);

    const blocks = calendar.querySelectorAll(".week-calendar__block");
    expect(blocks).toHaveLength(1);
    const [sunday] = blocksOn(calendar, "2026-10-11");
    expect(sunday.classList.contains("week-calendar__block--continues")).toBe(true);
    expect(sunday.textContent).toContain("(continues into next week)");
    expect(sunday.querySelector("button")?.getAttribute("title")).toBe(
      "Ana Diaz, 10 PM - 6 AM (ends the next day) (continues into next week)",
    );
    // It ends exactly at the bottom of Sunday.
    const { start, length } = placing(sunday);
    expect(start + length).toBeCloseTo(100, 6);
  });

  it("shows the name and the time in two lengths, and says it all in words", () => {
    const calendar = weekCalendar(KEYS, [nightShift("2026-10-05")]);

    const button = calendar.querySelector("button.calendar-shift");
    expect(button?.querySelector(".calendar-shift__name")?.textContent).toBe("Ana Diaz");
    expect(button?.querySelector(".calendar-shift__time--short")?.textContent).toBe("10p-6a");
    // The times are not read aloud: screen readers hear the description instead.
    for (const piece of button?.querySelectorAll(".calendar-shift__time") ?? []) {
      expect(piece.getAttribute("aria-hidden")).toBe("true");
    }
    // Pointing at the block shows who and the whole time, for blocks too narrow for it.
    expect(button?.getAttribute("title")).toBe("Ana Diaz, 10 PM - 6 AM (ends the next day)");
    // For screen readers: who, which day, the full time, and that it ends the next day.
    expect(button?.querySelector(".visually-hidden")?.textContent).toBe(
      "Ana Diaz, Monday, October 5, 10:00 PM - 6:00 AM +1 day (ends the next day)",
    );
  });

  it("colours each block by its person, and says whose it is for later filters", () => {
    const calendar = weekCalendar(KEYS, [
      shiftOn("2026-10-05"),
      shiftOn("2026-10-06", { employee: BEN }),
      shiftOn("2026-10-07"),
    ]);

    const [ana1, ben, ana2] = [...calendar.querySelectorAll(".week-calendar__block")];
    expect(ana1.classList.contains(personColourClass("u1"))).toBe(true);
    expect(ana2.classList.contains(personColourClass("u1"))).toBe(true);
    expect(ben.classList.contains(personColourClass("u2"))).toBe(true);
    expect(ana1.getAttribute("data-person")).toBe("u1");
    expect(ben.getAttribute("data-person")).toBe("u2");
  });

  it("never puts text into a style: only numbers, through its own custom properties", () => {
    const calendar = weekCalendar(KEYS, [
      shiftOn("2026-10-05", { employee: { id: XSS, display_name: XSS }, details: XSS }),
      nightShift("2026-10-06"),
    ]);

    // Everything with a style is a block, holding only numbers in our properties.
    const styled = calendar.querySelectorAll("[style]");
    expect(styled.length).toBe(3);
    for (const element of styled) {
      const style = /** @type {HTMLElement} */ (element).style;
      for (let index = 0; index < style.length; index += 1) {
        const name = style.item(index);
        expect(name).toMatch(/^--block-(start|length|column|columns)$/);
        expect(style.getPropertyValue(name)).toMatch(/^[0-9.e-]+$/);
      }
    }
  });

  it("leaves open shifts out of the calendar (they have their own section)", () => {
    const calendar = weekCalendar(KEYS, [
      shiftOn("2026-10-05"),
      shiftOn("2026-10-06", { id: "open", status: "open", employee: null }),
    ]);

    expect(calendar.querySelectorAll(".week-calendar__block")).toHaveLength(1);
  });

  it("marks a shift with an event or notes, with words for screen readers", () => {
    const calendar = weekCalendar(KEYS, [
      shiftOn("2026-10-05", { notes: "Bring the keys", event_name: "Inventory" }),
      shiftOn("2026-10-06", { id: "plain" }),
    ]);

    const [marked, plain] = calendar.querySelectorAll("button.calendar-shift");
    expect(marked.querySelector(".icon--event")).not.toBeNull();
    expect(marked.querySelector(".icon--note")).not.toBeNull();
    // Only icons on screen; the words are for screen readers, never the note itself.
    expect(marked.querySelector(".shift-extras")?.textContent).toBe("EventNotes");
    expect(marked.textContent).not.toContain("Bring the keys");
    expect(plain.querySelector(".shift-extras")).toBeNull();
  });

  it("shows names as text on the block, and the details as text in the popup", () => {
    const calendar = weekCalendar(KEYS, [
      shiftOn("2026-10-05", {
        employee: { id: "u9", display_name: XSS },
        details: XSS,
        notes: XSS,
        event_name: XSS,
      }),
    ]);
    document.body.append(calendar);

    const button = /** @type {HTMLButtonElement} */ (
      calendar.querySelector("button.calendar-shift")
    );
    expect(calendar.querySelector("img, script")).toBeNull();
    expect(button.querySelector(".calendar-shift__name")?.textContent).toBe(XSS);

    // The popup: every detail, as text.
    button.click();
    const popup = document.querySelector("dialog.shift-dialog");
    expect(popup?.querySelector("img, script")).toBeNull();
    expect(popup?.textContent).toContain(XSS);
    popup?.remove();
  });

  it("says so when nobody is scheduled this week, and still shows the days", () => {
    const calendar = weekCalendar(KEYS, [
      shiftOn("2026-10-06", { status: "open", employee: null }),
    ]);

    expect(calendar.querySelector(".week-calendar__empty")?.textContent).toBe(
      "Nobody is scheduled this week.",
    );
    expect(calendar.querySelectorAll(".week-calendar__day")).toHaveLength(7);
  });

  it("remembers where to open, and scrolls there once it has a size", () => {
    const calendar = weekCalendar(KEYS, [
      shiftOn("2026-10-06", { starts_at: "2026-10-06T12:00:00Z" }),
    ]);
    const scroller = /** @type {HTMLElement} */ (calendar.querySelector(".week-calendar__scroll"));
    // 12:00 UTC is 7:00 in Chicago.
    expect(scroller.dataset.firstHour).toBe("7");

    // jsdom lays nothing out, so give the day columns a size the way a browser would:
    // 24 hours of 48 pixels.
    for (const day of calendar.querySelectorAll(".week-calendar__day")) {
      Object.defineProperty(day, "offsetHeight", { value: 24 * 48 });
    }
    openAtFirstShift(calendar);
    // Seven hours down, less a quarter of an hour so the label shows under the headers.
    expect(scroller.scrollTop).toBe(7 * 48 - 12);
  });
});

describe("edit mode on the calendar", () => {
  /** A week far in the future, so its shifts can still change. */
  const FUTURE = "2099-10-05";
  const FUTURE_KEYS = Array.from({ length: 7 }, (_, offset) => addDays(FUTURE, offset));

  it("puts a select box on each shift once (not on a night shift's echo) and keeps it working", () => {
    vi.mocked(can).mockImplementation((code) => code === "schedule.edit");
    const shifts = [shiftOn("2099-10-05"), nightShift("2099-10-06", { employee: BEN })];
    const main = document.createElement("main");
    const tools = Object.assign(document.createElement("div"), { id: "edit-tools" });
    const bar = Object.assign(document.createElement("section"), { id: "batch-bar" });
    main.append(tools, weekCalendar(FUTURE_KEYS, shifts), bar);
    document.body.append(main);

    const editor = weekEditor({ reload: vi.fn() });
    editor.update({
      departmentId: "d1",
      monday: FUTURE,
      days: FUTURE_KEYS,
      shifts,
      people: null,
      today: "2099-10-05",
    });
    /** @type {HTMLButtonElement} */ (tools.querySelector(".edit-toggle")).click();

    // Two shifts, three blocks (the night shift has two pieces), two boxes: one per shift,
    // inside the block, next to the shift's real button.
    expect(main.querySelectorAll(".week-calendar__block")).toHaveLength(3);
    const boxes = /** @type {HTMLInputElement[]} */ ([
      ...main.querySelectorAll(".week-calendar__block .shift-pick__box"),
    ]);
    expect(boxes).toHaveLength(2);
    expect(boxes[0].closest(".shift-pick")?.querySelector("button.calendar-shift")).not.toBeNull();

    // Ticking a box selects the shift: the bar at the bottom says so.
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new Event("change"));
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toContain("1 shift selected");

    // Done editing: the boxes go, and the buttons are back in their blocks.
    /** @type {HTMLButtonElement} */ (tools.querySelector(".edit-toggle")).click();
    expect(main.querySelectorAll(".shift-pick")).toHaveLength(0);
    expect(main.querySelectorAll(".week-calendar__block > button.calendar-shift")).toHaveLength(2);
  });
});

describe("department picker", () => {
  /** The picker as the page has it: a wrapper with a label and an empty list. */
  function picker() {
    const wrapper = document.createElement("div");
    wrapper.id = "department-picker";
    wrapper.hidden = true;
    const select = document.createElement("select");
    wrapper.append(select);
    document.body.append(wrapper);
    return { wrapper, select };
  }

  const DEPARTMENTS = [
    { id: "d1", name: "Kitchen" },
    { id: "d2", name: XSS },
  ];

  it("lists the departments, names as text, with the one shown selected", () => {
    const { wrapper, select } = picker();

    showDepartmentPicker(wrapper, DEPARTMENTS, "d2");

    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ["d1", "Kitchen"],
      ["d2", XSS],
    ]);
    expect(select.querySelector("img, script")).toBeNull();
    expect(select.value).toBe("d2");
    expect(wrapper.hidden).toBe(false);
  });

  it("stays hidden when there is only one department", () => {
    const { wrapper } = picker();

    showDepartmentPicker(wrapper, [{ id: "d1", name: "Kitchen" }], "d1");

    expect(wrapper.hidden).toBe(true);
  });

  it("selects nothing real for a department it does not know", () => {
    const { wrapper, select } = picker();

    showDepartmentPicker(wrapper, DEPARTMENTS, "other-company");

    expect(select.value).toBe("");
    expect(select.options[0].textContent).toBe(CHOOSE);
    expect(select.options[0].disabled).toBe(true);
  });

  it("loads the chosen department for the same week, and puts it in the address", () => {
    const { wrapper, select } = picker();
    showDepartmentPicker(wrapper, DEPARTMENTS, "d1");
    window.history.replaceState(null, "", "?week=2026-10-05&department=d1");
    const load = vi.fn(() => Promise.resolve());
    followDepartmentPicker(load);

    select.value = "d2";
    select.dispatchEvent(new Event("change"));

    expect(window.location.search).toBe("?week=2026-10-05&department=d2");
    expect(load).toHaveBeenCalledWith("?week=2026-10-05&department=d2");
    window.history.replaceState(null, "", "/");
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
