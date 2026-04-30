import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const cleanupPaths: string[] = [];
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function workspace(name: string) {
  const dir = resolve(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  cleanupPaths.push(dir);
  return dir;
}

function writeJson(dir: string, name: string, value: unknown) {
  const file = resolve(dir, name);
  writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
  return file;
}

function runEvaluate(expected: string, actual: string) {
  try {
    const stdout = execFileSync("node", ["scripts/evaluate-document-analysis.mjs", "--expected", expected, "--actual", actual], {
      cwd: appRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, report: JSON.parse(stdout) };
  } catch (error) {
    const output = String((error as { stdout?: Buffer | string }).stdout ?? "{}");
    return { exitCode: 1, report: JSON.parse(output) };
  }
}

function expected(overrides: Record<string, unknown> = {}) {
  return {
    case_id: "runner-test",
    metadata: {
      manual_reviewed: false,
      expected_confidence: "low",
      source_of_truth: "synthetic",
      human_review_required: true,
      notes: "runner unit test",
    },
    expected: {
      item_count: { exact: 1 },
      required_fields: ["item", "description", "quantity", "reference_unit"],
      minimum_field_coverage: { reference_unit: 1 },
      warnings: { allow: true, max: 5 },
      pipeline: { required: true, allow_stage_failures: false, required_stages: ["final_result"] },
      ...overrides,
    },
  };
}

function actual(overrides: Record<string, unknown> = {}) {
  return {
    run: {
      status: "completed",
      result: {
        rows: [
          {
            item: "1",
            description: "Item demo",
            quantity: "2",
            reference_unit: "COP 1200",
          },
        ],
        warnings: [],
      },
    },
    stages: [{ stage_name: "final_result", status: "completed" }],
    ...overrides,
  };
}

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("document analysis runner", () => {
  it("passes a structurally valid result with required stages", () => {
    const dir = workspace("runner-pass");
    const result = runEvaluate(writeJson(dir, "expected.json", expected()), writeJson(dir, "actual.json", actual()));

    expect(result.exitCode).toBe(0);
    expect(result.report.status).toBe("passed");
  });

  it("fails when reference_unit is a unit instead of a money value", () => {
    const dir = workspace("runner-bad-reference");
    const result = runEvaluate(
      writeJson(dir, "expected.json", expected()),
      writeJson(
        dir,
        "actual.json",
        actual({
          run: { status: "completed", result: { rows: [{ item: "1", description: "Item", quantity: "2", reference_unit: "UND" }] } },
        }),
      ),
    );

    expect(result.exitCode).toBe(1);
    expect(result.report.checks.find((check: { name: string }) => check.name === "precios_techo")?.passed).toBe(false);
  });

  it("fails when pipeline stages are missing but expected requires them", () => {
    const dir = workspace("runner-missing-stages");
    const result = runEvaluate(writeJson(dir, "expected.json", expected()), writeJson(dir, "actual.json", actual({ stages: [] })));

    expect(result.exitCode).toBe(1);
    expect(result.report.checks.find((check: { name: string }) => check.name === "pipeline_stages")?.passed).toBe(false);
  });

  it("fails when a clean completed result hides an internal failed stage", () => {
    const dir = workspace("runner-failed-stage");
    const result = runEvaluate(
      writeJson(dir, "expected.json", expected()),
      writeJson(
        dir,
        "actual.json",
        actual({ stages: [{ stage_name: "final_result", status: "failed", error_message: "schema" }] }),
      ),
    );

    expect(result.exitCode).toBe(1);
    expect(result.report.checks.find((check: { name: string }) => check.name === "pipeline_stages")?.passed).toBe(false);
  });
});
