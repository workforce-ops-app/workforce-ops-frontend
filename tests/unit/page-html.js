// Put a real page's markup (pages/*.html) into the test document, so page scripts are
// tested against the HTML they ship with. DOMParser builds the elements without running
// any script, and only the <body> is copied over.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Replace the test document's body with the body of a page.
 * @param {string} name e.g. "set-password.html"
 */
export function loadPage(name) {
  // From the project folder, where the tests run (jsdom changes what import.meta.url is).
  const html = readFileSync(join(process.cwd(), "pages", name), "utf8");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const nodes = [...parsed.body.childNodes].map((node) => document.importNode(node, true));
  document.body.replaceChildren(...nodes);
}
