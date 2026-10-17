// Which logo each company shows in the header.
//
// TEMPORARY, for the demos only (issue #56): the two demo companies' logos ship with
// the frontend and are found by the company's name. Companies cannot upload their own
// logo yet; that needs a secure file upload on the backend
// (workforce-ops-app/workforce-ops-backend#101), which replaces this table: the
// session will then say whether the company has a logo and where to load it from.
//
// Until then, a company that is not listed here (or one whose name an administrator
// changes) simply keeps the application's logo.

/** The demo companies (backend scripts/seed_demo.py) and their logo files. */
const DEMO_LOGOS = new Map([
  ["Northwind Cafe", "/images/logos/northwind-cafe.png"],
  ["Summit Outfitters", "/images/logos/summit-outfitters.png"],
]);

/**
 * The logo file for a company, or null when it has none.
 *
 * A Map, not a plain object: looking up a name such as "constructor" or "__proto__" in
 * an object would find the object's own built-in properties instead of nothing. A Map
 * only knows the entries put into it.
 * @param {string} companyName
 * @returns {string | null}
 */
export function companyLogoPath(companyName) {
  return DEMO_LOGOS.get(companyName) ?? null;
}
