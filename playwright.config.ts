import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: { browserName: "chromium", deviceScaleFactor: 1 },
  reporter: "list",
});
