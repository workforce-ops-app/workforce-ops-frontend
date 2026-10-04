// CI check: no high or critical security advisory in our dependencies, except ones we
// accepted on purpose and wrote down in audit-allowlist.json.
//
//   node scripts/audit.js
//
// npm audit alone has no way to accept a single advisory: one advisory with no fix
// would block every pull request. This script runs `npm audit --json`, removes the
// advisories listed in the allowlist, and fails on anything that is left. An allowlist
// entry must say why it is safe and until when; after that date it fails again, so an
// exception is never forgotten.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Severities that fail the check (the same level as before: npm audit --audit-level=high). */
const BLOCKING = new Set(["high", "critical"]);

/**
 * @typedef {{ id: string, package: string, reason: string, review_by: string }} AllowlistEntry
 * @typedef {{ id: string, package: string, severity: string, title: string }} Advisory
 */

/**
 * The advisories in an `npm audit --json` report, one per advisory (not per package).
 *
 * npm lists every affected package. A package that is only affected because it depends
 * on a vulnerable one lists that package's name in `via`; the package with the actual
 * advisory lists the advisory itself (an object with its URL). Only the advisories count.
 * @param {any} report the parsed output of `npm audit --json`
 * @returns {Advisory[]}
 */
export function advisoriesIn(report) {
  /** @type {Map<string, Advisory>} */
  const found = new Map();

  // Look at every affected package.
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    // Each entry in `via` is either a package name (affected through it) or an advisory.
    for (const via of /** @type {any} */ (vulnerability).via ?? []) {
      if (typeof via !== "object" || via === null) continue;

      // The advisory's ID is the last part of its URL, e.g. GHSA-vfj7-8cjw-p6xm.
      const id =
        String(via.url ?? via.source)
          .split("/")
          .pop() ?? "";

      // The same advisory can be listed under several packages; keep it once.
      found.set(id, { id, package: via.name, severity: via.severity, title: via.title });
    }
  }
  return [...found.values()];
}

/**
 * Decide what fails the check.
 * @param {Advisory[]} advisories every advisory npm reported
 * @param {AllowlistEntry[]} allowlist the accepted exceptions
 * @param {Date} today
 * @returns {{ blocking: Advisory[], expired: AllowlistEntry[], unused: AllowlistEntry[] }}
 *   blocking: advisories that fail the check; expired: allowlist entries past their
 *   review date (they fail too); unused: entries that match nothing any more (remove them)
 */
export function evaluate(advisories, allowlist, today) {
  // An entry stops counting the day after its review date.
  const expired = allowlist.filter((entry) => new Date(`${entry.review_by}T23:59:59Z`) < today);
  const active = new Set(
    allowlist.filter((entry) => !expired.includes(entry)).map((entry) => entry.id),
  );

  // High and critical advisories fail, unless an active allowlist entry accepts them.
  const blocking = advisories.filter(
    (advisory) => BLOCKING.has(advisory.severity) && !active.has(advisory.id),
  );

  // Entries whose advisory npm no longer reports: the problem is gone, so the entry is
  // only noise now.
  const reported = new Set(advisories.map((advisory) => advisory.id));
  const unused = allowlist.filter((entry) => !reported.has(entry.id));

  return { blocking, expired, unused };
}

/** Run npm audit and the allowlist, print the result, and exit with 1 on failure. */
function main() {
  // npm audit exits with an error code whenever it finds anything, but still prints the
  // report, so read the output from the error in that case. The command is one fixed
  // string with nothing added from outside, so running it through the shell (which
  // Windows needs for npm) cannot be tricked into running anything else.
  let output;
  try {
    output = execSync("npm audit --json", { encoding: "utf8" });
  } catch (error) {
    output = /** @type {{ stdout: string }} */ (error).stdout;
  }

  const report = JSON.parse(output);
  const allowlist = JSON.parse(readFileSync("audit-allowlist.json", "utf8"));
  const { blocking, expired, unused } = evaluate(advisoriesIn(report), allowlist, new Date());

  // Report everything, then decide.
  for (const advisory of blocking) {
    console.log(`${advisory.severity}: ${advisory.package}: ${advisory.title} (${advisory.id})`);
  }
  for (const entry of expired) {
    console.log(`allowlist entry ${entry.id} passed its review date ${entry.review_by}`);
  }
  for (const entry of unused) {
    console.log(`allowlist entry ${entry.id} matches nothing any more; remove it`);
  }

  if (blocking.length > 0 || expired.length > 0) {
    console.log("audit failed");
    process.exit(1);
  }
  const accepted = allowlist.length - unused.length;
  console.log(`no high or critical vulnerabilities (${accepted} accepted in audit-allowlist.json)`);
}

// Run only when started as a script, not when the tests import the functions above.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"))) {
  main();
}
