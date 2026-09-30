// Unit tests run in Node.js with jsdom, a simulated browser page, so DOM code can be tested.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.js"],
    // The first tests arrive with the API client and DOM helpers.
    passWithNoTests: true,
  },
});
