import { describe, expect, it } from "vitest";
import { currentCostVersionId } from "../lib/cost-version-selection";
describe("una sola base en uso por identidad", () => {
 it("elige solo la recuperación más reciente aunque otras dos bases tengan el mismo contenido", () => {
  const history = [{id:"restore-4",stateDigest:"same",digest:"x"},{id:"ai-3",stateDigest:"other",digest:"x"},{id:"restore-2",stateDigest:"same",digest:"x"},{id:"manual-1",stateDigest:"same",digest:"x"}];
  const active = currentCostVersionId(history,"same","x");
  expect(active).toBe("restore-4");
  expect(history.filter(v=>v.id===active)).toHaveLength(1);
  expect(history.map(v=>v.id)).toEqual(["restore-4","ai-3","restore-2","manual-1"]);
 });
 it("no presenta una base como vigente cuando los costos tienen cambios sin guardar", () => {
  expect(currentCostVersionId([{id:"older",stateDigest:"old",digest:"same-display"}],"edited","same-display")).toBeNull();
 });
 it("conserva compatibilidad con bases antiguas sin digest completo y prioriza la última identidad", () => {
  expect(currentCostVersionId([{id:"new",digest:"match"},{id:"old",digest:"match"}],"full","match")).toBe("new");
 });
});
