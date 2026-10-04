// ESLint checks the JavaScript for mistakes and unsafe patterns.
// no-unsanitized blocks the most common cause of cross-site scripting (XSS):
// putting data into the page as HTML (innerHTML, outerHTML, insertAdjacentHTML,
// document.write). Pages show data with textContent or the helpers in js/core/.
import js from "@eslint/js";
import nounsanitized from "eslint-plugin-no-unsanitized";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/", "ci-results/", "ci-report/", "coverage/", "playwright-report/"],
  },
  js.configs.recommended,
  nounsanitized.configs.recommended,
  {
    // Code that runs in the browser.
    files: ["js/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    // Tool configuration, scripts, and tests run in Node.js.
    files: ["*.config.js", "scripts/**/*.js", "tests/**/*.js"],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      // Inline code built from strings is as dangerous as innerHTML.
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
];
