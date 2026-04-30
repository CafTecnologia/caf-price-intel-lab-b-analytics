const { test, expect } = require("@playwright/test");
const XLSX = require("xlsx");

const baseUrl = process.env.APP_B_BASE_URL || "http://127.0.0.1:18020";
const sampleRunId = process.env.APP_B_SAMPLE_RUN_ID || "0a30be51-3771-403d-bd32-7a7b835790ac";

test("App B smoke: home, config, matrix, backend and Excel export", async ({ page, request }) => {
  const pageErrors = [];
  const badResponses = [];

  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("response", (response) => {
    const status = response.status();
    const url = response.url();
    if (status >= 400 && !/favicon|robots|hot-update/i.test(url)) {
      badResponses.push({ status, url });
    }
  });

  async function gotoSettled(url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
  }

  await page.setViewportSize({ width: 1440, height: 1000 });

  await gotoSettled(baseUrl);
  await expect(page).toHaveTitle(/analisis Financiero - B/i);
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await expect(page.getByText(/Configuraci[oó]n IA/i).first()).toBeVisible();

  await page.getByText(/Configuraci[oó]n IA/i).first().click();
  await expect(page.getByText(/Proveedor/i).first()).toBeVisible();
  await expect(page.getByText(/Modelo/i).first()).toBeVisible();
  await expect(page.getByText(/Probar conexi[oó]n/i).first()).toBeVisible();

  const apiResponse = await request.get(`${baseUrl}/api/market-analysis/${sampleRunId}`);
  expect(apiResponse.ok()).toBeTruthy();
  const apiPayload = await apiResponse.json();
  const backendRows = apiPayload.run.result.rows;

  await gotoSettled(`${baseUrl}/market-analysis/${sampleRunId}`);
  await expect(page.getByText(/Matriz/i).first()).toBeVisible();
  await expect(page.getByText(/Descargar XLSX/i).first()).toBeVisible();
  await expect(page.locator("table.market-table tbody tr")).toHaveCount(backendRows.length);
  await expect(page.locator("table.market-table tbody tr").first()).toContainText(backendRows[0]["Ítem"]);
  await expect(page.locator("table.market-table tbody tr").first()).toContainText(backendRows[0]["Nombre o descripción"]);

  if (apiPayload.run.status !== "completed") {
    await expect(page.locator(".warning-panel").first()).toBeVisible();
    await expect(page.getByText(/Resumen para usuario/i).first()).toBeVisible();
    await expect(page.getByText(/Notas relevantes de la corrida/i).first()).toBeVisible();
  }

  if (apiPayload.run.result.warnings.length > 0) {
    await expect(page.locator(".warning-panel").first()).toBeVisible();
  }

  await expect(page.getByText(/Caja negra t[eé]cnica/i).first()).toBeVisible();
  await expect(page.locator(".trace-log-blackbox")).not.toHaveAttribute("open", "");
  const visibleMatrixText = await page.locator("body").innerText();
  expect(visibleMatrixText).not.toMatch(/STREAM_GEMINI|Modelo IA efectivo|Conteo previo Gemini|Auditoria local previa/i);

  const exportResponse = await request.get(`${baseUrl}/api/market-analysis/${sampleRunId}/export?format=xlsx`);
  expect(exportResponse.ok()).toBeTruthy();
  const workbook = XLSX.read(await exportResponse.body(), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Matriz);
  expect(rows).toHaveLength(backendRows.length);
  expect(rows[0]["Ítem"]).toBe(backendRows[0]["Ítem"]);
  expect(rows[0]["Nombre o descripción"]).toBe(backendRows[0]["Nombre o descripción"]);

  await gotoSettled(`${baseUrl}/market-analysis/${sampleRunId}/financial`);
  await expect(page.getByText(/Simulador financiero|DECISI[oó]N FINANCIERA/i).first()).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
