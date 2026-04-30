module.exports = {
  testDir: "./tests/e2e",
  testMatch: "*.pw.cjs",
  timeout: 90_000,
  use: {
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]],
};
