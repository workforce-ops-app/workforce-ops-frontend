// The dependency audit CI runs (ci.toml, "audit"): `npm audit`, failing on any high or
// critical advisory except the ones listed in audit-allowlist.json
// (workforce-ops-app/workforce-ops-frontend#85).
//
// Why a list instead of the bypass label: sometimes an advisory has no fixed release yet,
// so no update can clear it. The bypass label turns the whole audit off for one pull
// request, and does nothing for pushes to main. The list accepts one exact advisory, for a
// written reason, until a date, and the audit keeps catching everything else.
//
// Each entry in audit-allowlist.json looks like this; every field is required:
//   {
//     "id": "GHSA-xxxx-xxxx-xxxx",     the advisory, exactly (never a package or severity)
//     "package": "picomatch",          the package it is in, for people reading the list
//     "reason": "...",                 why it is safe to accept for now
//     "issue": "#81",                  the issue that ends the exception
//     "expires": "2026-12-17"          the last day it is accepted (at most 30 days ahead)
//   }
//
// Run it with:  node scripts/audit.js
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Severities that fail the audit, as before (npm audit --audit-level=high). */
const FAILING = new Set(["high", "critical"]);

/** The longest an exception may be granted for, in days. */
export const MAX_DAYS = 30;

/** The fields every allowlist entry must have. */
const FIELDS = ["id", "package", "reason", "issue", "expires"];

/**
 * @typedef {{ id: string, package: string, reason: string, issue: string, expires: string }} Entry
 * @typedef {{ id: string, package: string, severity: string, title: string }} Advisory
 * @typedef {{ failures: string[], notes: string[] }} Verdict
 */

/**
 * The advisories in an `npm audit --json` report, each once.
 *
 * The report lists every affected package, but only the package an advisory is really in
 * carries it as an object (with its URL and severity); the packages that merely depend on
 * it name that package as a string. So the advisories are the objects, and their IDs are
 * the last part of their URLs (https://github.com/advisories/GHSA-...).
 * @param {any} report the parsed report
 * @returns {Advisory[]}
 */
export function advisoriesIn(report) {
  /** @type {Map<string, Advisory>} */
  const found = new Map();
  for (const entry of Object.values(report?.vulnerabilities ?? {})) {
    for (const cause of /** @type {any} */ (entry).via ?? []) {
      // A string names another package: its own entry holds the advisory.
      if (typeof cause !== "object" || cause === null) continue;
      const id =
        String(cause.url ?? "")
          .split("/")
          .pop() || `npm-${cause.source}`;
      found.set(id, {
        id,
        package: String(cause.name ?? ""),
        severity: String(cause.severity ?? ""),
        title: String(cause.title ?? ""),
      });
    }
  }
  return [...found.values()];
}

/**
 * Whether the audit passes: the decision on its own, so the tests can check it without
 * running npm.
 * @param {any} report the parsed `npm audit --json` report
 * @param {unknown} allowlist the parsed audit-allowlist.json
 * @param {string} today "YYYY-MM-DD"
 * @returns {Verdict} the audit fails if failures is not empty; notes are for information
 */
export function judge(report, allowlist, today) {
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const notes = [];

  // 1. The list itself must be well formed: an array of complete entries, none expired,
  //    none granted for longer than MAX_DAYS from today. A broken entry accepts nothing.
  /** @type {Map<string, Entry>} */
  const accepted = new Map();
  if (!Array.isArray(allowlist)) {
    failures.push("audit-allowlist.json must be a list ([]).");
  } else {
    const latest = addDays(today, MAX_DAYS);
    for (const [index, raw] of allowlist.entries()) {
      const entry = /** @type {Record<string, unknown>} */ (raw ?? {});
      const label = typeof entry.id === "string" && entry.id ? entry.id : `entry ${index + 1}`;
      const missing = FIELDS.filter(
        (field) => typeof entry[field] !== "string" || !String(entry[field]).trim(),
      );
      if (missing.length) {
        failures.push(`${label} in audit-allowlist.json is missing: ${missing.join(", ")}.`);
        continue;
      }
      const expires = String(entry.expires);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
        failures.push(`${label}: "expires" must be a date written YYYY-MM-DD.`);
        continue;
      }
      if (expires < today) {
        failures.push(
          `${label} expired on ${expires} (${entry.issue}). Fix it, or renew it with a new reason.`,
        );
        continue;
      }
      if (expires > latest) {
        failures.push(`${label}: "expires" may be at most ${MAX_DAYS} days ahead (${latest}).`);
        continue;
      }
      accepted.set(label, /** @type {Entry} */ (/** @type {unknown} */ (entry)));
    }
  }

  // 2. Every high or critical advisory must be on the list.
  const advisories = advisoriesIn(report);
  for (const advisory of advisories) {
    if (!FAILING.has(advisory.severity)) continue;
    const entry = accepted.get(advisory.id);
    if (entry) {
      notes.push(
        `Accepted until ${entry.expires}: ${advisory.id} in ${advisory.package} (${entry.issue}).`,
      );
    } else {
      failures.push(
        `${advisory.severity}: ${advisory.id} in ${advisory.package}: ${advisory.title}`,
      );
    }
  }

  // 3. Entries for advisories that are gone can come off the list.
  const present = new Set(advisories.map((advisory) => advisory.id));
  for (const id of accepted.keys()) {
    if (!present.has(id)) {
      notes.push(`${id} no longer appears in the audit: remove it from audit-allowlist.json.`);
    }
  }
  return { failures, notes };
}

/**
 * A day key moved by a number of days.
 * @param {string} key "YYYY-MM-DD"
 * @param {number} days
 * @returns {string}
 */
function addDays(key, days) {
  const moment = new Date(`${key}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return moment.toISOString().slice(0, 10);
}

/** Run the audit and report, exiting with 1 if it fails. */
function main() {
  // 1. npm audit exits with 1 whenever it finds anything, even something on the list, so
  //    its exit code is ignored and the report decides.
  let output;
  try {
    // A fixed command with no outside input, run through the shell so "npm" is found on
    // every system (npm.cmd on Windows).
    output = execSync("npm audit --json", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    output = /** @type {{ stdout?: string }} */ (error).stdout ?? "";
  }
  let report;
  try {
    report = JSON.parse(output);
  } catch {
    console.error("npm audit did not produce a report:\n" + output);
    process.exit(1);
  }
  if (report.error) {
    console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
    process.exit(1);
  }

  // 2. The list, next to package.json.
  const listPath = fileURLToPath(new URL("../audit-allowlist.json", import.meta.url));
  const allowlist = JSON.parse(readFileSync(listPath, "utf8"));

  // 3. The verdict, with "today" as a UTC date (the same for every machine and CI).
  const { failures, notes } = judge(report, allowlist, new Date().toISOString().slice(0, 10));
  for (const note of notes) console.log(note);
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exit(1);
  }
  console.log("no high or critical vulnerabilities outside the allowlist");
}

// Run only when started directly (node scripts/audit.js), not when the tests import it.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
