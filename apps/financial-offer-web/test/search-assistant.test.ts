import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLocalSearchQuery, buildSearchQueryWithDeepSeek } from "../lib/search-assistant";
import type { AppAiConfig } from "../lib/app-config";

const item = {
  description: "Filtro de aceite Chevrolet DMAX",
  technicalDescription: "Compatible con motor diésel 2.5, rosca M20, altura 90 mm",
  notes: "Presupuesto estimado 31.200 COP. No confundir con otro lote.",
  priceSources: [{ label: "Otra marca", url: "https://proveedor.example/no-relacionado", notes: "Otro producto" }],
};
const config: AppAiConfig = { deepseekApiKey: "test-key", deepseekModel: "deepseek-flash" };

afterEach(() => vi.unstubAllGlobals());

describe("consulta de búsqueda comercial", () => {
  it("construye un respaldo breve desde nombre y ficha sin copiar notas ni enlaces", () => {
    const query = buildLocalSearchQuery(item);
    expect(query).toContain("Filtro de aceite Chevrolet DMAX");
    expect(query).toContain("diésel 2.5");
    expect(query).not.toContain("Presupuesto");
    expect(query).not.toContain("Otra marca");
    expect(query).not.toContain("Colombia");
    expect(query.split(" ").length).toBeLessThanOrEqual(24);
  });

  it("usa la consulta sintetizada por la IA y expone que fue la fuente", async () => {
    const mockedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "Filtro aceite Chevrolet DMAX diésel 2.5 rosca M20" } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", mockedFetch);

    const result = await buildSearchQueryWithDeepSeek(item, config);

    expect(result.source).toBe("deepseek");
    expect(result.query).toContain("rosca M20");
    expect(result.url).toContain(encodeURIComponent("rosca M20"));
    const request = JSON.parse(mockedFetch.mock.calls[0]![1].body as string) as { model: string; thinking: { type: string } };
    expect(request.model).toBe("deepseek-flash");
    expect(request.thinking.type).toBe("disabled");
  });

  it("identifica el respaldo local si falla la IA o devuelve una respuesta vacía", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const failed = await buildSearchQueryWithDeepSeek(item, config);
    expect(failed.source).toBe("local");
    expect(failed.query).toBe(buildLocalSearchQuery(item));

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "" } }],
    }), { status: 200 })));
    const empty = await buildSearchQueryWithDeepSeek(item, config);
    expect(empty.source).toBe("local");
  });
});

