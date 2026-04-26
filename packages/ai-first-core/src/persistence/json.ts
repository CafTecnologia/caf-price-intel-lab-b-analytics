import type { Prisma } from "@prisma/client";

export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export function toJsonArray(values: string[]): Prisma.InputJsonValue {
  return toJsonValue(values);
}
