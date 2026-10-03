// Unit tests run in Node.js with jsdom, a simulated browser page, so DOM code can be tested.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.js"],
    coverage: {
      provider: "v8",
      // Shared code is unit-tested; page scripts (js/pages/) are tested in the browser
      // by the integration tests.
      include: ["js/api/**/*.js", "js/core/**/*.js", "js/components/**/*.js"],
      reporter: ["text"],
    },
  },
});
