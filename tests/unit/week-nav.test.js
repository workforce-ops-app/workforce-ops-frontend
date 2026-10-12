// Moving between weeks in place: the address changes, only the week loads again.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followWeekLinks } from "../../js/components/week-nav.js";

/** The parts of a week page the links need: <main> with the three week links. */
function weekPage() {
  /**
   * @param {string} id
   * @param {string} href
   */
  const link = (id, href) => {
    const a = document.createElement("a");
    a.id = id;
    a.href = href;
    return a;
  };
  const main = document.createElement("main");
  main.append(
    link("previous-week", "?week=2026-09-28"),
    link("current-week", "?week=2026-10-05&department=d1"),
    link("next-week", "?week=2026-10-12"),
  );
  document.body.replaceChildren(main);
}

const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const main = () => /** @type {HTMLElement} */ (document.querySelector("main"));

/** A load the test answers when it chooses, to look at the page in between. */
function heldLoad() {
  /** @type {() => void} */
  let finish = () => {};
  const done = new Promise((resolve) => (finish = () => resolve(undefined)));
  return { done, finish };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/pages/my-shifts.html?week=2026-10-05");
  weekPage();
});
afterEach(() => document.body.replaceChildren());

describe("followWeekLinks", () => {
  it("loads the next week in place and changes the address", async () => {
    const showWeek = vi.fn().mockResolvedValue(undefined);
    followWeekLinks(showWeek);

    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    byId("next-week").dispatchEvent(click);

    // No page load: the click is handled here, and the address is the next week's.
    expect(click.defaultPrevented).toBe(true);
    expect(window.location.search).toBe("?week=2026-10-12");
    await vi.waitFor(() => expect(showWeek).toHaveBeenCalledWith("?week=2026-10-12"));
  });

  it("loads the current week in place and keeps other address settings", async () => {
    const showWeek = vi.fn().mockResolvedValue(undefined);
    followWeekLinks(showWeek);

    byId("current-week").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );

    expect(window.location.search).toBe("?week=2026-10-05&department=d1");
    await vi.waitFor(() =>
      expect(showWeek).toHaveBeenCalledWith("?week=2026-10-05&department=d1"),
    );
  });

  it("leaves a click that opens a new tab to the browser", () => {
    const showWeek = vi.fn().mockResolvedValue(undefined);
    followWeekLinks(showWeek);

    // Note whether the page stopped the click, then stop it here, since the test browser
    // cannot open the link (the page's own listener runs first, on the link).
    let leftToBrowser = false;
    const stop = (/** @type {Event} */ event) => {
      leftToBrowser = !event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener("click", stop, { once: true });

    byId("next-week").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }),
    );

    expect(leftToBrowser).toBe(true);
    expect(showWeek).not.toHaveBeenCalled();
  });

  it("shows the address's week on Back and Forward", async () => {
    const showWeek = vi.fn().mockResolvedValue(undefined);
    followWeekLinks(showWeek);

    window.history.replaceState(null, "", "/pages/my-shifts.html?week=2026-09-28");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await vi.waitFor(() => expect(showWeek).toHaveBeenCalledWith("?week=2026-09-28"));
  });

  it("marks the page busy while a week loads", async () => {
    const held = heldLoad();
    const load = followWeekLinks(() => held.done);

    const loading = load("?week=2026-10-12");
    expect(main().getAttribute("aria-busy")).toBe("true");

    held.finish();
    await loading;
    expect(main().hasAttribute("aria-busy")).toBe(false);
  });

  it("loads one week at a time and ends on the latest one asked for", async () => {
    // Three quick clicks: the first load is still on its way when the others arrive.
    const held = heldLoad();
    const showWeek = vi.fn().mockReturnValueOnce(held.done).mockResolvedValue(undefined);
    const load = followWeekLinks(showWeek);

    const loading = load("?week=2026-10-12");
    load("?week=2026-10-19");
    load("?week=2026-10-26");
    // Only the first has started; the middle one is skipped, since it is no longer wanted.
    expect(showWeek).toHaveBeenCalledTimes(1);

    held.finish();
    await loading;
    expect(showWeek.mock.calls.map(([search]) => search)).toEqual([
      "?week=2026-10-12",
      "?week=2026-10-26",
    ]);
    expect(main().hasAttribute("aria-busy")).toBe(false);
  });

  it("takes the next click after a load that failed", async () => {
    const showWeek = vi.fn().mockRejectedValueOnce(new TypeError("a bug"));
    const load = followWeekLinks(showWeek);

    await expect(load("?week=2026-10-12")).rejects.toThrow("a bug");
    expect(main().hasAttribute("aria-busy")).toBe(false);

    showWeek.mockResolvedValue(undefined);
    await load("?week=2026-10-19");
    expect(showWeek).toHaveBeenLastCalledWith("?week=2026-10-19");
  });
});
