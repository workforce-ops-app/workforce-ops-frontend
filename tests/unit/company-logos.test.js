// The demo companies' logos, found by the company's name (js/core/company-logos.js).
import { describe, expect, it } from "vitest";
import { companyLogoPath } from "../../js/core/company-logos.js";

describe("companyLogoPath", () => {
  it("finds each demo company's logo by its exact name", () => {
    expect(companyLogoPath("Northwind Cafe")).toBe("/images/logos/northwind-cafe.png");
    expect(companyLogoPath("Summit Outfitters")).toBe("/images/logos/summit-outfitters.png");
  });

  it("has no logo for any other company", () => {
    expect(companyLogoPath("Acme")).toBeNull();
    // The name must match exactly, the way the seed script writes it.
    expect(companyLogoPath("northwind cafe")).toBeNull();
  });

  it("finds nothing for names of built-in object properties", () => {
    // A plain object lookup would return a function for these; the Map knows only its
    // own entries.
    expect(companyLogoPath("constructor")).toBeNull();
    expect(companyLogoPath("__proto__")).toBeNull();
    expect(companyLogoPath("toString")).toBeNull();
  });
});
