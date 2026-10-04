// The dependency audit's allowlist: accepted advisories pass, everything else still fails.
import { describe, expect, it } from "vitest";
import { advisoriesIn, evaluate } from "../../scripts/audit.js";

/** A small `npm audit --json` report: one advisory, and a package affected through it. */
const report = {
  vulnerabilities: {
    braces: {
      severity: "high",
      via: [
        {
          source: 1,
          name: "braces",
          title: "stack exhaustion",
          url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
          severity: "high",
        },
      ],
    },
    stylelint: { severity: "high", via: ["braces"] },
  },
};

const today = new Date("2026-10-03T12:00:00Z");

/**
 * An allowlist entry for the advisory above.
 * @param {string} reviewBy
 */
function entry(reviewBy) {
  return { id: "GHSA-aaaa-bbbb-cccc", package: "braces", reason: "test", review_by: reviewBy };
}

describe("advisoriesIn", () => {
  it("counts each advisory once, not each affected package", () => {
    const advisories = advisoriesIn(report);

    expect(advisories).toEqual([
      { id: "GHSA-aaaa-bbbb-cccc", package: "braces", severity: "high", title: "stack exhaustion" },
    ]);
  });

  it("finds nothing in a clean report", () => {
    expect(advisoriesIn({ vulnerabilities: {} })).toEqual([]);
  });
});

describe("evaluate", () => {
  it("fails on a high advisory that is not in the allowlist", () => {
    const { blocking } = evaluate(advisoriesIn(report), [], today);

    expect(blocking.map((a) => a.id)).toEqual(["GHSA-aaaa-bbbb-cccc"]);
  });

  it("passes when the advisory is in the allowlist and its review date has not passed", () => {
    const result = evaluate(advisoriesIn(report), [entry("2026-10-03")], today);

    expect(result).toEqual({ blocking: [], expired: [], unused: [] });
  });

  it("fails again once the review date has passed", () => {
    const { blocking, expired } = evaluate(advisoriesIn(report), [entry("2026-10-02")], today);

    expect(expired.map((e) => e.id)).toEqual(["GHSA-aaaa-bbbb-cccc"]);
    expect(blocking.map((a) => a.id)).toEqual(["GHSA-aaaa-bbbb-cccc"]);
  });

  it("does not fail on moderate or low advisories, as before", () => {
    const moderate = [{ id: "GHSA-x", package: "p", severity: "moderate", title: "t" }];

    expect(evaluate(moderate, [], today).blocking).toEqual([]);
  });

  it("reports an allowlist entry that no longer matches anything", () => {
    const { blocking, unused } = evaluate([], [entry("2026-12-31")], today);

    expect(blocking).toEqual([]);
    expect(unused.map((e) => e.id)).toEqual(["GHSA-aaaa-bbbb-cccc"]);
  });
});
