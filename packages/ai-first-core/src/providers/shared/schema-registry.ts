import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { NormalizedItemSchema } from "../../../../ai-first-contracts/src/schemas/item";
import { DetectionSummarySchema } from "../../../../ai-first-contracts/src/schemas/source";
import {
  BatchValidationResultSchema,
  GlobalValidationResultSchema,
} from "../../../../ai-first-contracts/src/schemas/validation";

const NormalizedItemArraySchema = z.array(NormalizedItemSchema).max(20);

const schemaRegistry = {
  DetectionSummarySchema,
  BatchValidationResultSchema,
  GlobalValidationResultSchema,
  "NormalizedItemSchema[]": NormalizedItemArraySchema,
} as const;

export type KnownResponseSchemaName = keyof typeof schemaRegistry;

export function getResponseSchema(name: string) {
  const schema = schemaRegistry[name as KnownResponseSchemaName];
  if (!schema) {
    throw new Error(`Unsupported response schema: ${name}`);
  }

  return schema;
}

export function getResponseJsonSchema(name: string) {
  const schema = getResponseSchema(name);
  return zodToJsonSchema(schema, {
    name,
    $refStrategy: "none",
  });
}

function stripGeminiUnsupportedKeywords(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripGeminiUnsupportedKeywords(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "$schema" || key === "definitions" || key === "default") {
      continue;
    }

    output[key] = stripGeminiUnsupportedKeywords(nestedValue);
  }

  return output;
}

export function getGeminiCompatibleResponseJsonSchema(name: string) {
  const generated = getResponseJsonSchema(name) as Record<string, unknown>;
  const topLevelRef = typeof generated.$ref === "string" ? generated.$ref : null;
  const definitions =
    generated.definitions && typeof generated.definitions === "object"
      ? (generated.definitions as Record<string, unknown>)
      : null;

  if (topLevelRef?.startsWith("#/definitions/") && definitions) {
    const definitionName = topLevelRef.slice("#/definitions/".length);
    const unwrapped = definitions[definitionName];

    if (unwrapped && typeof unwrapped === "object") {
      return stripGeminiUnsupportedKeywords(unwrapped);
    }
  }

  return stripGeminiUnsupportedKeywords(generated);
}
