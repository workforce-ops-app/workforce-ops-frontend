// The dependency audit's decision (scripts/audit.js, workforce-ops-frontend#85): every
// high or critical advisory fails CI unless audit-allowlist.json lists it, completely and
// unexpired. The tests feed it made-up reports, so npm never runs.
import { describe, expect, it } from "vitest";
import { advisoriesIn, judge, MAX_DAYS } from "../../scripts/audit.js";

const TODAY = "2026-11-17";

/**
 * A report shaped like `npm audit --json`: the package with the advisory carries it as an
 * object; a package that only depends on it names it as a string.
 * @param {{ id: string, severity: string }[]} advisories
 */
function report(advisories) {
  /** @type {Record<string, { via: unknown[] }>} */
  const vulnerabilities = { vite: { via: ["picomatch"] } };
  for (const { id, severity } of advisories) {
    vulnerabilities[`pkg-${id}`] = {
      via: [
        {
          url: `https://github.com/advisories/${id}`,
          name: `pkg-${id}`,
          severity,
          title: `problem ${id}`,
        },
      ],
    };
  }
  return { vulnerabilities };
}

/** A complete allowlist entry, changed as a test needs. */
function entry(changes = {}) {
  return {
    id: "GHSA-aaaa",
    package: "pkg-GHSA-aaaa",
    reason: "test tools only",
    issue: "#81",
    expires: "2026-12-01",
    ...changes,
  };
}

describe("advisoriesIn", () => {
  it("finds each advisory once, by its ID, and skips packages that only depend on it", () => {
    const found = advisoriesIn(report([{ id: "GHSA-aaaa", severity: "high" }]));
    expect(found).toEqual([
      { id: "GHSA-aaaa", package: "pkg-GHSA-aaaa", severity: "high", title: "problem GHSA-aaaa" },
    ]);
  });
});

describe("judge", () => {
  it("passes a report with nothing high or critical", () => {
    const verdict = judge(report([{ id: "GHSA-low", severity: "moderate" }]), [], TODAY);
    expect(verdict.failures).toEqual([]);
  });

  it("fails on a high or critical advisory that is not listed, naming it", () => {
    const verdict = judge(
      report([
        { id: "GHSA-high", severity: "high" },
        { id: "GHSA-crit", severity: "critical" },
      ]),
      [],
      TODAY,
    );
    expect(verdict.failures).toHaveLength(2);
    expect(verdict.failures[0]).toContain("GHSA-high");
    expect(verdict.failures[1]).toContain("GHSA-crit");
  });

  it("accepts a listed advisory, and still fails on any other", () => {
    const verdict = judge(
      report([
        { id: "GHSA-aaaa", severity: "high" },
        { id: "GHSA-bbbb", severity: "high" },
      ]),
      [entry()],
      TODAY,
    );
    // The listed one is only a note; the new one fails.
    expect(verdict.notes.join()).toContain("Accepted until 2026-12-01: GHSA-aaaa");
    expect(verdict.failures).toHaveLength(1);
    expect(verdict.failures[0]).toContain("GHSA-bbbb");
  });

  it("accepts an entry on its last day, and fails it the day after", () => {
    const high = report([{ id: "GHSA-aaaa", severity: "high" }]);
    expect(judge(high, [entry({ expires: TODAY })], TODAY).failures).toEqual([]);
    const expired = judge(high, [entry({ expires: "2026-11-16" })], TODAY).failures;
    // Both the expired entry and the advisory it no longer covers are reported.
    expect(expired.join()).toContain("expired on 2026-11-16");
    expect(expired.join()).toContain("high: GHSA-aaaa");
  });

  it(`refuses an entry granted for more than ${MAX_DAYS} days`, () => {
    const verdict = judge(
      report([{ id: "GHSA-aaaa", severity: "high" }]),
      [entry({ expires: "2027-06-01" })],
      TODAY,
    );
    expect(verdict.failures.join()).toContain(`at most ${MAX_DAYS} days ahead`);
  });

  it("refuses an entry missing a field or with a badly written date", () => {
    const high = report([{ id: "GHSA-aaaa", severity: "high" }]);
    const missing = judge(high, [entry({ reason: " " })], TODAY).failures;
    expect(missing.join()).toContain("missing: reason");
    const badDate = judge(high, [entry({ expires: "December 1" })], TODAY).failures;
    expect(badDate.join()).toContain("YYYY-MM-DD");
  });

  it("refuses a list that is not a list", () => {
    expect(judge(report([]), { id: "GHSA-aaaa" }, TODAY).failures.join()).toContain(
      "must be a list",
    );
  });

  it("says when a listed advisory is gone, without failing", () => {
    const verdict = judge(report([]), [entry()], TODAY);
    expect(verdict.failures).toEqual([]);
    expect(verdict.notes.join()).toContain("GHSA-aaaa no longer appears");
  });
});
