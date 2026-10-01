// The DOM helpers only ever put text on the page (threat model T5, stored XSS).
import { describe, expect, it } from "vitest";
import { clear, el, setText } from "../../js/core/dom.js";

const XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

describe("el", () => {
  it("creates an element with text", () => {
    const p = el("p", { text: "Hello" });

    expect(p.tagName).toBe("P");
    expect(p.textContent).toBe("Hello");
  });

  it("keeps HTML in text as text", () => {
    const p = el("p", { text: XSS });

    expect(p.textContent).toBe(XSS);
    expect(p.querySelector("img")).toBeNull();
    expect(p.querySelector("script")).toBeNull();
    expect(p.innerHTML).toContain("&lt;script&gt;");
  });

  it("sets the class and attributes", () => {
    const link = el("a", {
      className: "nav",
      attrs: { href: "/pages/sign-in.html", title: "Sign in" },
    });

    expect(link.className).toBe("nav");
    expect(link.getAttribute("href")).toBe("/pages/sign-in.html");
    expect(link.getAttribute("title")).toBe("Sign in");
  });

  it("refuses event-handler attributes", () => {
    expect(() => el("img", { attrs: { onerror: "alert(1)" } })).toThrow();
    expect(() => el("div", { attrs: { ONCLICK: "alert(1)" } })).toThrow();
  });

  it("refuses javascript: links", () => {
    expect(() => el("a", { attrs: { href: "javascript:alert(1)" } })).toThrow();
    expect(() => el("a", { attrs: { href: "  JavaScript:alert(1)" } })).toThrow();
  });

  it("appends children, with strings as text", () => {
    const list = el("ul", {}, [el("li", { text: "one" }), XSS]);

    expect(list.children).toHaveLength(1);
    expect(list.textContent).toBe("one" + XSS);
    expect(list.querySelector("script")).toBeNull();
  });
});

describe("setText", () => {
  it("replaces the content with text", () => {
    const div = el("div", {}, [el("span", { text: "old" })]);

    setText(div, XSS);

    expect(div.textContent).toBe(XSS);
    expect(div.querySelector("span")).toBeNull();
    expect(div.querySelector("script")).toBeNull();
  });

  it("shows numbers as text and null as empty", () => {
    const div = el("div");

    setText(div, 42);
    expect(div.textContent).toBe("42");

    setText(div, null);
    expect(div.textContent).toBe("");
  });
});

describe("clear", () => {
  it("removes everything inside", () => {
    const div = el("div", {}, [el("p", { text: "a" }), el("p", { text: "b" })]);

    clear(div);

    expect(div.childNodes).toHaveLength(0);
  });
});
