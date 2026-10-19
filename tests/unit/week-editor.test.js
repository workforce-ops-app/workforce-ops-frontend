// Edit mode of the department week: who gets it, selecting shifts, the count confirmation,
// plain-language refusals, and the add and change forms.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../../js/api/client.js";

// The server: each test decides what it answers.
vi.mock("../../js/api/shifts.js", () => ({
  listShifts: vi.fn(),
  createShift: vi.fn(),
  updateShift: vi.fn(),
  assignShift: vi.fn(),
  cancelShift: vi.fn(),
  batchShifts: vi.fn(),
}));
// Who is signed in, and what they may do.
vi.mock("../../js/core/session.js", () => ({ can: vi.fn(), currentSession: vi.fn() }));

const api = await import("../../js/api/shifts.js");
const { can, currentSession } = await import("../../js/core/session.js");
const { CONFIRM_AT, describeShift, isChangeable, peopleFrom, shiftMoments, weekEditor } =
  await import("../../js/components/week-editor.js");
const { dayCard } = await import("../../js/components/day-list.js");
const { closeShiftDialog } = await import("../../js/components/shift-dialog.js");
const { addDays } = await import("../../js/core/time.js");

/** @param {unknown} fn */
const asMock = (fn) => /** @type {import("vitest").Mock} */ (fn);

const XSS = '<img src=x onerror="alert(1)">';
const CHICAGO = "America/Chicago";
/** A week far in the future, so its shifts can still change. */
const MONDAY = "2099-10-05";
const DAYS = Array.from({ length: 7 }, (_, i) => addDays(MONDAY, i));

/**
 * A shift in Chicago, 9:00 to 17:00 local time (14:00 to 22:00 UTC in October).
 * @param {string} id
 * @param {string} day
 * @param {Partial<import("../../js/api/shifts.js").Shift>} [overrides]
 * @returns {import("../../js/api/shifts.js").Shift}
 */
function shift(id, day, overrides = {}) {
  return {
    id,
    department: { id: "d1", name: "Kitchen" },
    employee: { id: "u1", display_name: "Ana Diaz" },
    starts_at: `${day}T14:00:00Z`,
    ends_at: `${day}T22:00:00Z`,
    timezone: CHICAGO,
    status: "scheduled",
    details: "Prep line",
    notes: null,
    event_name: null,
    event_description: null,
    ...overrides,
  };
}

/** @type {import("vitest").Mock} */
let reload;

/**
 * The page as the department week builds it: the edit tools, the week as day cards, and
 * the bar. Then edit mode, given this week.
 * @param {import("../../js/api/shifts.js").Shift[]} shifts
 * @param {{ permissions?: string[], people?: import("../../js/api/shifts.js").EmployeeRef[] | null }} [options]
 */
function setUp(shifts, options = {}) {
  const permissions = options.permissions ?? ["schedule.view", "schedule.edit"];
  asMock(can).mockImplementation((/** @type {string} */ code) => permissions.includes(code));

  const main = document.createElement("main");
  const tools = document.createElement("div");
  tools.id = "edit-tools";
  tools.hidden = true;
  const days = document.createElement("div");
  days.id = "days";
  const bar = document.createElement("section");
  bar.id = "batch-bar";
  bar.hidden = true;
  main.append(tools, days, bar);
  document.body.replaceChildren(main);

  /** @param {import("../../js/api/shifts.js").Shift[]} list */
  const render = (list) =>
    days.replaceChildren(
      ...DAYS.map((key) =>
        dayCard(
          key,
          list.filter((s) => s.starts_at.startsWith(key)),
          { showEmployee: true },
        ),
      ),
    );
  render(shifts);

  const editor = weekEditor({ reload });
  editor.update({
    departmentId: "d1",
    monday: MONDAY,
    days: DAYS,
    shifts,
    people: options.people ?? null,
    today: "2099-10-07",
  });
  return { editor, render };
}

/** Find an element; fail the test clearly when it is missing. */
function get(/** @type {string} */ selector) {
  const found = document.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`Missing ${selector}`);
  return found;
}

/** The button with exactly this text. */
function button(/** @type {string} */ text, root = document.body) {
  const found = [...root.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!found) throw new Error(`No button "${text}"`);
  return found;
}

const toggle = () => get("#edit-tools .edit-toggle");
const boxes = () =>
  /** @type {HTMLInputElement[]} */ ([...document.querySelectorAll(".shift-pick__box")]);
const dialog = () => document.querySelector("dialog.edit-dialog");

/** Let the awaited requests and the re-render finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A request that answers only when the test says so, to look at the page meanwhile. */
function held() {
  /** @type {(value: unknown) => void} */
  let answer = () => {};
  const promise = new Promise((resolve) => {
    answer = resolve;
  });
  return { promise, answer: () => answer({}) };
}

/**
 * Press Escape on a popup, as the browser does: a "cancel" event the page may hold back.
 * @param {Element} box
 * @returns {boolean} true when the popup was held open
 */
function escape(box) {
  const event = new Event("cancel", { cancelable: true });
  box.dispatchEvent(event);
  return event.defaultPrevented;
}

/**
 * Close a popup the way a browser may anyway (Escape pressed twice in a row, which a page
 * cannot hold back again).
 * @param {Element} box
 */
function forceClose(box) {
  box.removeAttribute("open");
  box.dispatchEvent(new Event("close"));
}

/**
 * Tick a select box, as a click would.
 * @param {HTMLInputElement} box
 */
function tick(box) {
  box.checked = true;
  box.dispatchEvent(new Event("change"));
}

beforeEach(() => {
  reload = vi.fn().mockResolvedValue(undefined);
  for (const fn of Object.values(api)) asMock(fn).mockReset();
  asMock(api.listShifts).mockResolvedValue([]);
  asMock(api.batchShifts).mockResolvedValue({ action: "assign", count: 1, items: [] });
  asMock(currentSession).mockReturnValue({ company: { timezone: CHICAGO } });
});

afterEach(() => {
  closeShiftDialog();
  document.querySelectorAll("dialog").forEach((d) => d.remove());
  document.body.replaceChildren();
});

describe("who gets edit mode", () => {
  it("shows nothing without schedule.edit", () => {
    setUp([shift("s1", MONDAY)], { permissions: ["schedule.view"] });

    expect(get("#edit-tools").hidden).toBe(true);
    expect(get("#edit-tools").textContent).toBe("");
  });

  it("shows the Edit week button with schedule.edit, switched off", () => {
    setUp([shift("s1", MONDAY)]);

    expect(get("#edit-tools").hidden).toBe(false);
    expect(toggle().textContent).toBe("Edit week");
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(boxes()).toHaveLength(0);
    expect(button("Add shift").hidden).toBe(true);
  });
});

describe("switching edit mode on and off", () => {
  it("adds a select box to every shift that can still change, and Add shift", () => {
    setUp([shift("s1", MONDAY), shift("s2", DAYS[1]), shift("old", "2020-01-06")]);

    toggle().click();

    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(toggle().textContent).toBe("Done editing");
    expect(button("Add shift").hidden).toBe(false);
    // The ended shift (2020) gets no box: the server would refuse to change it.
    expect(boxes()).toHaveLength(2);
    expect(boxes()[0].getAttribute("aria-label")).toBe(
      "Select Monday, October 5, 9:00 AM - 5:00 PM, Ana Diaz",
    );
  });

  it("takes the boxes and the selection away again", () => {
    setUp([shift("s1", MONDAY)]);
    toggle().click();
    tick(boxes()[0]);

    toggle().click();

    expect(boxes()).toHaveLength(0);
    expect(get("#batch-bar").hidden).toBe(true);
    // The shift buttons are back where they were.
    expect(document.querySelectorAll("#days [data-shift-id]")).toHaveLength(1);
  });

  it("keeps a name with HTML in it as plain text in the box's label", () => {
    setUp([shift("s1", MONDAY, { employee: { id: "u9", display_name: XSS } })]);
    toggle().click();

    expect(boxes()[0].getAttribute("aria-label")).toContain(XSS);
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("the bar for selected shifts", () => {
  it("counts the selection and keeps every box of the same shift in step", () => {
    setUp([shift("s1", MONDAY), shift("s2", DAYS[1])]);
    toggle().click();

    tick(boxes()[0]);

    expect(get("#batch-bar").hidden).toBe(false);
    expect(get(".batch-bar__count").textContent).toBe("1 shift selected");
    tick(boxes()[1]);
    expect(get(".batch-bar__count").textContent).toBe("2 shifts selected");

    button("Clear selection").click();
    expect(get("#batch-bar").hidden).toBe(true);
    expect(boxes().every((b) => !b.checked)).toBe(true);
  });

  it("assigns a small selection straight away, without confirm_count, then reloads", async () => {
    setUp([shift("s1", MONDAY), shift("s2", DAYS[1], { employee: null, status: "open" })], {
      people: [{ id: "u2", display_name: "Ben Okafor" }],
    });
    toggle().click();
    tick(boxes()[0]);
    tick(boxes()[1]);
    /** @type {HTMLSelectElement} */ (get("#batch-person")).value = "u2";

    button("Assign").click();
    await settle();

    expect(api.batchShifts).toHaveBeenCalledWith({
      action: "assign",
      employee_id: "u2",
      shift_ids: ["s1", "s2"],
    });
    expect(reload).toHaveBeenCalled();
    expect(get(".edit-message").textContent).toBe("2 shifts changed.");
  });

  it("makes shifts open with employee_id null", async () => {
    setUp([shift("s1", MONDAY)]);
    toggle().click();
    tick(boxes()[0]);

    button("Make open").click();
    await settle();

    expect(api.batchShifts).toHaveBeenCalledWith({
      action: "assign",
      employee_id: null,
      shift_ids: ["s1"],
    });
  });

  it("asks first from 10 shifts on, then sends the count to confirm", async () => {
    const many = Array.from({ length: 12 }, (_, i) => shift(`s${i}`, DAYS[i % 7]));
    setUp(many);
    toggle().click();
    // Every shift has one box here (day cards only), so 12 boxes.
    boxes().forEach(tick);
    expect(CONFIRM_AT).toBe(10);

    button("Make open").click();
    await settle();

    // Nothing sent yet: the question comes first.
    expect(api.batchShifts).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("This will change 12 shifts.");

    button("Make open: 12 shifts", /** @type {HTMLElement} */ (dialog())).click();
    await settle();

    expect(api.batchShifts).toHaveBeenCalledWith({
      action: "assign",
      employee_id: null,
      // In the order the boxes were ticked (day by day here).
      shift_ids: boxes().map((b) => b.dataset.pick),
      confirm_count: 12,
    });
    expect(dialog()).toBeNull();
    expect(reload).toHaveBeenCalled();
  });

  it("sends nothing when the person goes back from the question", async () => {
    setUp(Array.from({ length: 10 }, (_, i) => shift(`s${i}`, DAYS[i % 7])));
    toggle().click();
    boxes().forEach(tick);

    button("Make open").click();
    await settle();
    button("Go back", /** @type {HTMLElement} */ (dialog())).click();
    await settle();

    expect(api.batchShifts).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("explains a 409 in plain words next to the selection", async () => {
    setUp([shift("s1", MONDAY)], { people: [{ id: "u2", display_name: "Ben Okafor" }] });
    asMock(api.batchShifts).mockRejectedValue(
      new ApiError(409, {
        title: "Conflict",
        detail: "This person already has a shift at that time.",
      }),
    );
    toggle().click();
    tick(boxes()[0]);

    button("Assign").click();
    await settle();

    const problem = get("#batch-bar [role=alert]");
    expect(problem.hidden).toBe(false);
    expect(problem.textContent).toBe("This person already has a shift at that time.");
    expect(reload).not.toHaveBeenCalled();
  });

  it("always asks before cancelling, and says the change cannot be undone", async () => {
    setUp([shift("s1", MONDAY), shift("s2", DAYS[1])]);
    toggle().click();
    boxes().forEach(tick);

    button("Cancel shifts").click();
    await settle();

    expect(dialog()?.textContent).toContain("cannot be changed again");
    button("Cancel 2 shifts", /** @type {HTMLElement} */ (dialog())).click();
    await settle();

    expect(api.batchShifts).toHaveBeenCalledWith({ action: "cancel", shift_ids: ["s1", "s2"] });
    expect(get(".edit-message").textContent).toBe("2 shifts cancelled.");
  });

  it("keeps the question open with the reason when the server refuses", async () => {
    setUp([shift("s1", MONDAY)]);
    asMock(api.batchShifts).mockRejectedValue(
      new ApiError(403, { title: "Forbidden", detail: "You do not have permission to do this." }),
    );
    toggle().click();
    tick(boxes()[0]);

    button("Cancel shift").click();
    await settle();
    button("Cancel shift", /** @type {HTMLElement} */ (dialog())).click();
    await settle();

    expect(dialog()?.querySelector("[role=alert]")?.textContent).toBe(
      "You do not have permission to do this.",
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("sends a change of the selection once, however often it is clicked", async () => {
    setUp([shift("s1", MONDAY)]);
    const request = held();
    asMock(api.batchShifts).mockReturnValue(request.promise);
    toggle().click();
    tick(boxes()[0]);

    button("Make open").click();
    // While it is on its way, every button in the bar is off.
    expect(button("Make open").hasAttribute("disabled")).toBe(true);
    expect(button("Cancel shift").hasAttribute("disabled")).toBe(true);
    expect(get("#batch-bar").hasAttribute("aria-busy")).toBe(true);
    // A click that arrives anyway (before the bar was drawn again) sends nothing more.
    button("Make open").removeAttribute("disabled");
    button("Make open").click();

    request.answer();
    await settle();

    expect(api.batchShifts).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("switches the bar back on after a refusal, to try again", async () => {
    setUp([shift("s1", MONDAY)]);
    asMock(api.batchShifts).mockRejectedValueOnce(
      new ApiError(409, { title: "Conflict", detail: "This shift was cancelled." }),
    );
    toggle().click();
    tick(boxes()[0]);

    button("Make open").click();
    await settle();

    expect(button("Make open").hasAttribute("disabled")).toBe(false);
    expect(get("#batch-bar").hasAttribute("aria-busy")).toBe(false);
    button("Make open").click();
    await settle();
    expect(api.batchShifts).toHaveBeenCalledTimes(2);
  });

  it("cannot be left while a cancel is being sent", async () => {
    setUp([shift("s1", MONDAY)]);
    const request = held();
    asMock(api.batchShifts).mockReturnValue(request.promise);
    toggle().click();
    tick(boxes()[0]);
    button("Cancel shift").click();
    await settle();
    const box = /** @type {HTMLElement} */ (dialog());

    button("Cancel shift", box).click();

    // Go back is off and Escape is held back until the server answers.
    expect(button("Go back", box).hasAttribute("disabled")).toBe(true);
    expect(escape(box)).toBe(true);
    expect(dialog()).not.toBeNull();

    request.answer();
    await settle();
    expect(dialog()).toBeNull();
    expect(get(".edit-message").textContent).toBe("1 shift cancelled.");
  });

  it("still reloads the week when the browser closes the question while it is sending", async () => {
    setUp([shift("s1", MONDAY)]);
    const request = held();
    asMock(api.batchShifts).mockReturnValue(request.promise);
    toggle().click();
    tick(boxes()[0]);
    button("Cancel shift").click();
    await settle();
    const box = /** @type {HTMLElement} */ (dialog());
    button("Cancel shift", box).click();

    forceClose(box);
    await settle();
    // Not reported as "nothing happened" while the answer is still on its way.
    expect(reload).not.toHaveBeenCalled();

    request.answer();
    await settle();
    expect(reload).toHaveBeenCalled();
    expect(get(".edit-message").textContent).toBe("1 shift cancelled.");
  });
});

describe("one shift, from its details popup", () => {
  it("offers Change and Cancel only in edit mode", () => {
    setUp([shift("s1", MONDAY)]);
    const shiftButton = get("#days [data-shift-id]");

    shiftButton.click();
    expect(document.querySelector(".shift-dialog__actions")).toBeNull();
    closeShiftDialog();

    toggle().click();
    get("#days [data-shift-id]").click();
    expect(get(".shift-dialog").textContent).toContain("Change shift");
    expect(get(".shift-dialog").textContent).toContain("Cancel shift");
  });

  it("says an ended shift can no longer be changed", () => {
    setUp([shift("old", "2020-01-06")]);
    toggle().click();

    // The ended shift is not in this week's day cards, so open it directly.
    get("#edit-tools");
    const card = dayCard("2020-01-06", [shift("old", "2020-01-06")], {});
    document.body.append(card);
    /** @type {HTMLElement} */ (card.querySelector("[data-shift-id]")).click();

    expect(get(".shift-dialog").textContent).toContain("can no longer be changed");
    expect(get(".shift-dialog").textContent).not.toContain("Change shift");
  });

  it("cancels one shift after asking", async () => {
    setUp([shift("s1", MONDAY)]);
    asMock(api.cancelShift).mockResolvedValue({});
    toggle().click();
    get("#days [data-shift-id]").click();

    button("Cancel shift", get(".shift-dialog")).click();
    await settle();
    button("Cancel shift", /** @type {HTMLElement} */ (dialog())).click();
    await settle();

    expect(api.cancelShift).toHaveBeenCalledWith("s1");
    expect(get(".edit-message").textContent).toBe("Shift cancelled.");
  });

  it("sends only what changed: new notes with PATCH, a new person with assign", async () => {
    setUp([shift("s1", MONDAY)], { people: [{ id: "u2", display_name: "Ben Okafor" }] });
    asMock(api.updateShift).mockResolvedValue({});
    asMock(api.assignShift).mockResolvedValue({});
    toggle().click();
    get("#days [data-shift-id]").click();
    button("Change shift", get(".shift-dialog")).click();
    await settle();

    // The form starts with the shift's own values, in workplace time.
    expect(/** @type {HTMLInputElement} */ (get("#shift-form-start")).value).toBe("09:00");
    expect(/** @type {HTMLInputElement} */ (get("#shift-form-end")).value).toBe("17:00");
    expect(/** @type {HTMLInputElement} */ (get("#shift-form-role")).value).toBe("Prep line");

    /** @type {HTMLTextAreaElement} */ (get("#shift-form-notes")).value = "Bring gloves";
    /** @type {HTMLSelectElement} */ (get("#shift-form-person")).value = "u2";
    button("Save changes").click();
    await settle();

    expect(api.updateShift).toHaveBeenCalledWith("s1", { notes: "Bring gloves" });
    expect(api.assignShift).toHaveBeenCalledWith("s1", "u2");
    expect(get(".edit-message").textContent).toBe("Shift saved.");
  });

  it("shows a 409 in the form, which stays open", async () => {
    setUp([shift("s1", MONDAY)]);
    asMock(api.updateShift).mockRejectedValue(
      new ApiError(409, {
        title: "Conflict",
        detail: "This shift has ended and can no longer be changed.",
      }),
    );
    toggle().click();
    get("#days [data-shift-id]").click();
    button("Change shift", get(".shift-dialog")).click();
    await settle();

    /** @type {HTMLInputElement} */ (get("#shift-form-end")).value = "18:00";
    button("Save changes").click();
    await settle();

    expect(dialog()?.querySelector("[role=alert]")?.textContent).toBe(
      "This shift has ended and can no longer be changed.",
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("says what was saved when the details were saved but the person was not", async () => {
    setUp([shift("s1", MONDAY)], { people: [{ id: "u2", display_name: "Ben Okafor" }] });
    asMock(api.updateShift).mockResolvedValue({});
    asMock(api.assignShift).mockRejectedValueOnce(
      new ApiError(409, {
        title: "Conflict",
        detail: "This person already has a shift at that time.",
      }),
    );
    toggle().click();
    get("#days [data-shift-id]").click();
    button("Change shift", get(".shift-dialog")).click();
    await settle();

    /** @type {HTMLTextAreaElement} */ (get("#shift-form-notes")).value = "Bring gloves";
    /** @type {HTMLSelectElement} */ (get("#shift-form-person")).value = "u2";
    button("Save changes").click();
    await settle();

    // Not "nothing was saved": the notes were.
    expect(dialog()?.querySelector("[role=alert]")?.textContent).toBe(
      "The times and details were saved, but who works the shift was not changed. " +
        "This person already has a shift at that time.",
    );
    // The week behind the form already shows the saved notes.
    expect(reload).toHaveBeenCalledTimes(1);

    // Trying again sends only the person; the notes are not sent a second time.
    asMock(api.assignShift).mockResolvedValueOnce({});
    button("Save changes").click();
    await settle();
    expect(api.updateShift).toHaveBeenCalledTimes(1);
    expect(api.assignShift).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
    expect(get(".edit-message").textContent).toBe("Shift saved.");
  });

  it("keeps a plain refusal when only the person was changed", async () => {
    setUp([shift("s1", MONDAY)], { people: [{ id: "u2", display_name: "Ben Okafor" }] });
    asMock(api.assignShift).mockRejectedValue(
      new ApiError(409, {
        title: "Conflict",
        detail: "This person already has a shift at that time.",
      }),
    );
    toggle().click();
    get("#days [data-shift-id]").click();
    button("Change shift", get(".shift-dialog")).click();
    await settle();

    /** @type {HTMLSelectElement} */ (get("#shift-form-person")).value = "u2";
    button("Save changes").click();
    await settle();

    // Nothing was saved, so nothing is said to be.
    expect(dialog()?.querySelector("[role=alert]")?.textContent).toBe(
      "This person already has a shift at that time.",
    );
    expect(api.updateShift).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("adding shifts", () => {
  it("adds one shift with POST, in workplace time", async () => {
    setUp([shift("s1", MONDAY)]);
    asMock(api.createShift).mockResolvedValue({});
    toggle().click();
    button("Add shift").click();
    await settle();

    // Today (Wednesday) is ticked when it is in the week.
    const ticked = [...document.querySelectorAll("input[name=days]:checked")];
    expect(ticked.map((b) => /** @type {HTMLInputElement} */ (b).value)).toEqual(["2099-10-07"]);
    /** @type {HTMLInputElement} */ (get("#shift-form-role")).value = `  ${XSS}  `;
    button("Add shift", /** @type {HTMLElement} */ (dialog())).click();
    await settle();

    expect(api.createShift).toHaveBeenCalledWith({
      department_id: "d1",
      employee_id: null,
      starts_at: "2099-10-07T14:00:00.000Z",
      ends_at: "2099-10-07T22:00:00.000Z",
      // Trimmed, and sent as typed: the server stores text, the pages show it as text.
      details: XSS,
      notes: null,
      event_name: null,
      event_description: null,
    });
    expect(get(".edit-message").textContent).toBe("Shift added.");
  });

  it("adds the same shift on several days in one batch", async () => {
    setUp([]);
    toggle().click();
    button("Add shift").click();
    await settle();

    for (const key of [DAYS[0], DAYS[1]]) {
      /** @type {HTMLInputElement} */ (get(`#shift-form-day-${key}`)).checked = true;
    }
    button("Add shift", /** @type {HTMLElement} */ (dialog())).click();
    await settle();

    const body = asMock(api.batchShifts).mock.calls[0][0];
    expect(body.action).toBe("create");
    expect(body.times).toHaveLength(3);
    expect(body.confirm_count).toBeUndefined();
    expect(get(".edit-message").textContent).toBe("3 shifts added.");
  });

  it("refuses an empty choice of days before asking the server", async () => {
    setUp([]);
    toggle().click();
    button("Add shift").click();
    await settle();
    for (const box of document.querySelectorAll("input[name=days]")) {
      /** @type {HTMLInputElement} */ (box).checked = false;
    }

    button("Add shift", /** @type {HTMLElement} */ (dialog())).click();
    await settle();

    expect(dialog()?.querySelector("[role=alert]")?.textContent).toBe("Choose at least one day.");
    expect(api.createShift).not.toHaveBeenCalled();
  });

  it("says when the server cannot be reached, without claiming nothing was saved", async () => {
    setUp([]);
    asMock(api.createShift).mockRejectedValue(new NetworkError(new TypeError("offline")));
    toggle().click();
    button("Add shift").click();
    await settle();

    button("Add shift", /** @type {HTMLElement} */ (dialog())).click();
    await settle();

    const text = dialog()?.querySelector("[role=alert]")?.textContent ?? "";
    expect(text).toContain("The server could not be reached");
    // The request may have been saved before the connection failed.
    expect(text).toContain("may or may not have been saved");
    expect(text).toContain("Check the schedule before trying again.");
    expect(text).not.toContain("Nothing was saved");
  });

  it("cannot be left while the shift is being added", async () => {
    setUp([]);
    const request = held();
    asMock(api.createShift).mockReturnValue(request.promise);
    toggle().click();
    button("Add shift").click();
    await settle();
    const box = /** @type {HTMLElement} */ (dialog());

    button("Add shift", box).click();

    expect(button("Go back", box).hasAttribute("disabled")).toBe(true);
    expect(button("Add shift", box).hasAttribute("disabled")).toBe(true);
    expect(escape(box)).toBe(true);
    // Enter pressed again sends nothing more.
    box.querySelector("form")?.requestSubmit();
    expect(api.createShift).toHaveBeenCalledTimes(1);

    request.answer();
    await settle();
    expect(dialog()).toBeNull();
    expect(get(".edit-message").textContent).toBe("Shift added.");
  });

  it("lets Escape close the form again once nothing is being sent", async () => {
    setUp([]);
    toggle().click();
    button("Add shift").click();
    await settle();

    expect(escape(/** @type {HTMLElement} */ (dialog()))).toBe(false);
  });

  it("still reloads the week when the browser closes the form while it is sending", async () => {
    setUp([]);
    const request = held();
    asMock(api.createShift).mockReturnValue(request.promise);
    toggle().click();
    button("Add shift").click();
    await settle();
    const box = /** @type {HTMLElement} */ (dialog());
    button("Add shift", box).click();

    forceClose(box);
    await settle();
    expect(reload).not.toHaveBeenCalled();

    request.answer();
    await settle();
    expect(reload).toHaveBeenCalled();
    expect(get(".edit-message").textContent).toBe("Shift added.");
  });

  it("lists everyone who worked in the department lately as people to choose", async () => {
    asMock(api.listShifts).mockResolvedValue([
      shift("p1", "2099-09-21", { employee: { id: "u3", display_name: "Cara Lee" } }),
    ]);
    setUp([shift("s1", MONDAY)]);
    toggle().click();
    await settle();

    // Three weeks back to the end of this week, one department.
    expect(api.listShifts).toHaveBeenCalledWith({
      from: "2099-09-14",
      to: "2099-10-11",
      departmentId: "d1",
    });
    button("Add shift").click();
    await settle();
    const names = [...document.querySelectorAll("#shift-form-person option")].map(
      (o) => o.textContent,
    );
    expect(names).toEqual(["Open shift (nobody yet)", "Ana Diaz", "Cara Lee"]);
  });

  it("disables Add shift while no week is loaded", () => {
    const { editor } = setUp([]);
    toggle().click();

    editor.update(null);

    expect(button("Add shift").hasAttribute("disabled")).toBe(true);
  });
});

describe("helpers", () => {
  it("puts an end at or before the start on the next day (overnight shifts)", () => {
    expect(shiftMoments("2099-10-05", "22:00", "06:00", CHICAGO)).toEqual({
      starts_at: "2099-10-06T03:00:00.000Z",
      ends_at: "2099-10-06T11:00:00.000Z",
    });
  });

  it("tells shifts that can still change from cancelled or ended ones", () => {
    const now = new Date("2099-10-05T18:00:00Z");
    expect(isChangeable(shift("a", MONDAY), now)).toBe(true);
    expect(isChangeable(shift("b", MONDAY, { status: "cancelled" }), now)).toBe(false);
    expect(isChangeable(shift("c", "2099-10-04"), now)).toBe(false);
  });

  it("lists each person once, by name", () => {
    const list = peopleFrom(
      [{ id: "u2", display_name: "Ben Okafor" }],
      [
        shift("a", MONDAY),
        shift("b", MONDAY, { employee: { id: "u2", display_name: "Ben Okafor" } }),
      ],
    );
    expect(list.map((p) => p.display_name)).toEqual(["Ana Diaz", "Ben Okafor"]);
  });

  it("describes an open shift in words", () => {
    expect(describeShift(shift("a", MONDAY, { employee: null }))).toBe(
      "Monday, October 5, 9:00 AM - 5:00 PM, open shift",
    );
  });
});

describe("explainFailure", () => {
  it("turns each kind of failure into plain words, and leaves bugs alone", async () => {
    const { explainFailure, PartlySaved } = await import("../../js/components/modal.js");

    expect(
      explainFailure(
        new ApiError(422, {
          title: "Unprocessable Content",
          errors: [{ location: "body.ends_at", message: "Input should be a valid datetime" }],
        }),
      ),
    ).toBe("Input should be a valid datetime");
    expect(explainFailure(new ApiError(401, { title: "Unauthorized" }))).toBe(
      "Your session has ended. Sign in again to save changes.",
    );
    expect(explainFailure(new ApiError(500, { title: "Internal Server Error" }))).toBe(
      "Internal Server Error",
    );
    expect(explainFailure(new TypeError("a bug"))).toBeNull();
    expect(explainFailure(new NetworkError(new TypeError("offline")))).toBe(
      "The server could not be reached, so the change may or may not have been saved. " +
        "Check the schedule before trying again.",
    );
    // Part saved: what was, then why the rest was not; a bug underneath stays a bug.
    expect(
      explainFailure(
        new PartlySaved("The notes were saved.", new ApiError(403, { title: "Forbidden" })),
      ),
    ).toBe("The notes were saved. Forbidden");
    expect(explainFailure(new PartlySaved("The notes were saved.", new TypeError()))).toBeNull();
  });
});

describe("the end-time line in the form", () => {
  it("says an overnight shift ends the next day, and how long it is", async () => {
    const { endSummary } = await import("../../js/components/shift-form.js");

    expect(endSummary(["2099-10-05"], "22:00", "06:00", CHICAGO)).toEqual({
      text: "Ends the next day, Tuesday, October 6 at 6:00 AM. 8 hours.",
      warning: false,
    });
    expect(endSummary(["2099-10-05"], "09:00", "17:00", CHICAGO).text).toBe(
      "Ends the same day at 5:00 PM. 8 hours.",
    );
    expect(endSummary(["2099-10-05", "2099-10-06"], "22:00", "06:00", CHICAGO).text).toBe(
      "Each shift ends the next day at 6:00 AM. 8 hours each.",
    );
  });

  it("warns early about a shift over 12 hours, or with no length", async () => {
    const { endSummary } = await import("../../js/components/shift-form.js");

    const tooLong = endSummary(["2099-10-05"], "09:00", "08:00", CHICAGO);
    expect(tooLong.warning).toBe(true);
    expect(tooLong.text).toBe(
      "Ends the next day, Tuesday, October 6 at 8:00 AM. 23 hours. That is longer than the 12-hour limit, so it cannot be saved.",
    );
    expect(endSummary(["2099-10-05"], "09:00", "09:00", CHICAGO)).toEqual({
      text: "A shift must end after it starts.",
      warning: true,
    });
    expect(endSummary(["2099-10-05"], "", "06:00", CHICAGO).text).toBe("");
  });

  it("updates while the times change", async () => {
    setUp([]);
    toggle().click();
    button("Add shift").click();
    await settle();

    expect(get("#shift-form-summary").textContent).toBe("Ends the same day at 5:00 PM. 8 hours.");
    const start = /** @type {HTMLInputElement} */ (get("#shift-form-start"));
    const end = /** @type {HTMLInputElement} */ (get("#shift-form-end"));
    start.value = "22:00";
    start.dispatchEvent(new Event("input"));
    end.value = "06:00";
    end.dispatchEvent(new Event("input"));

    expect(get("#shift-form-summary").textContent).toBe(
      "Ends the next day, Thursday, October 8 at 6:00 AM. 8 hours.",
    );
  });

  it("names the next day in a select box's label for an overnight shift", () => {
    expect(
      describeShift(
        shift("n", MONDAY, { starts_at: "2099-10-06T03:00:00Z", ends_at: "2099-10-06T11:00:00Z" }),
      ),
    ).toBe("Monday, October 5, 10:00 PM - 6:00 AM (ends the next day), Ana Diaz");
  });
});
