// The announcement text renderer: **bold** pairs become <strong>, everything else stays
// text, and nothing in an announcement is ever treated as HTML (threat T5, stored XSS).
import { describe, expect, it } from "vitest";
import { announcementText, boldParts } from "../../js/components/announcement-text.js";

/**
 * Render text into a fresh <div>, the way the cards do.
 * @param {string} text
 */
function render(text) {
  const box = document.createElement("div");
  box.append(...announcementText(text));
  return box;
}

/**
 * The tag names of every element inside, so a test can say "only <strong>".
 * @param {Element} box
 */
const tags = (box) => [...box.querySelectorAll("*")].map((element) => element.tagName);

describe("boldParts", () => {
  it("turns a pair of ** marks into a bold part", () => {
    expect(boldParts("Bring **gloves** today")).toEqual([
      { bold: false, text: "Bring " },
      { bold: true, text: "gloves" },
      { bold: false, text: " today" },
    ]);
  });

  it("finds several pairs, from left to right", () => {
    expect(boldParts("**a** and **b**")).toEqual([
      { bold: true, text: "a" },
      { bold: false, text: " and " },
      { bold: true, text: "b" },
    ]);
  });

  it("keeps a lone ** as typed", () => {
    expect(boldParts("2 ** 3")).toEqual([{ bold: false, text: "2 ** 3" }]);
    // A third mark has no partner after the first pair.
    expect(boldParts("**a** then ** alone")).toEqual([
      { bold: true, text: "a" },
      { bold: false, text: " then ** alone" },
    ]);
  });

  it("keeps an empty pair (****) as typed", () => {
    expect(boldParts("****")).toEqual([{ bold: false, text: "****" }]);
    expect(boldParts("a **** b")).toEqual([{ bold: false, text: "a **** b" }]);
  });

  it("reads runs of stars two at a time from the left", () => {
    // "***x***": the first two stars open, the next two (after "*x") close, and the last
    // star is left over as text.
    expect(boldParts("***x***")).toEqual([
      { bold: true, text: "*x" },
      { bold: false, text: "*" },
    ]);
    // A single star is never a mark.
    expect(boldParts("*not bold*")).toEqual([{ bold: false, text: "*not bold*" }]);
  });

  it("keeps line breaks, including inside bold, and unifies Windows line endings", () => {
    expect(boldParts("Line one\r\n**Line\ntwo**\rend")).toEqual([
      { bold: false, text: "Line one\n" },
      { bold: true, text: "Line\ntwo" },
      { bold: false, text: "\nend" },
    ]);
  });

  it("shows nothing for a missing value", () => {
    expect(boldParts(null)).toEqual([]);
    expect(boldParts(undefined)).toEqual([]);
    expect(boldParts("")).toEqual([]);
  });
});

describe("announcementText", () => {
  it("makes the bold part a <strong> and the rest text nodes", () => {
    const nodes = announcementText("Bring **gloves** today");

    expect(nodes).toHaveLength(3);
    expect(nodes[0].nodeType).toBe(Node.TEXT_NODE);
    expect(nodes[1]).toBeInstanceOf(HTMLElement);
    expect(/** @type {HTMLElement} */ (nodes[1]).tagName).toBe("STRONG");
    expect(nodes[1].textContent).toBe("gloves");
    expect(nodes[2].nodeType).toBe(Node.TEXT_NODE);
  });

  it("shows a <script> tag as text and creates no script element", () => {
    const box = render("Hello <script>alert(1)</script>");

    expect(box.textContent).toBe("Hello <script>alert(1)</script>");
    expect(box.querySelector("script")).toBeNull();
    expect(tags(box)).toEqual([]);
  });

  it("shows an <img onerror> as text, in plain and in bold parts", () => {
    const payload = "<img src=x onerror=alert(1)>";
    const box = render(`${payload} and **${payload}**`);

    expect(box.textContent).toBe(`${payload} and ${payload}`);
    expect(box.querySelector("img")).toBeNull();
    // The only element is the bold part, and its content is text.
    expect(tags(box)).toEqual(["STRONG"]);
    expect(box.querySelector("strong")?.textContent).toBe(payload);
    expect(box.querySelector("strong")?.childElementCount).toBe(0);
  });

  it("keeps HTML-looking bold markers as text: <b>, <strong>, and closing tags", () => {
    const box = render("<b>not bold</b> <strong>nor this</strong> </div><div>");

    expect(box.textContent).toBe("<b>not bold</b> <strong>nor this</strong> </div><div>");
    expect(tags(box)).toEqual([]);
  });

  it("creates no element but <strong> for odd and nested stars", () => {
    for (const text of ["****", "***x***", "** **x** **", "**a**b**c**", "*a* **b", "******"]) {
      const box = render(text);
      // Every element is a <strong>, and every <strong> holds only text.
      for (const tag of tags(box)) expect(tag, text).toBe("STRONG");
      for (const strong of box.querySelectorAll("strong")) {
        expect(strong.childElementCount, text).toBe(0);
      }
      // Nothing is lost: the stars that were not marks are still there as text.
      expect(box.textContent?.replaceAll("*", "").length, text).toBe(
        text.replaceAll("*", "").length,
      );
    }
  });

  it("shows an empty pair as the four stars typed", () => {
    const box = render("****");

    expect(box.textContent).toBe("****");
    expect(box.querySelector("strong")).toBeNull();
  });

  it("keeps line breaks as text (no <br> needed)", () => {
    const box = render("First line\nSecond line");

    expect(box.textContent).toBe("First line\nSecond line");
    expect(tags(box)).toEqual([]);
  });
});
