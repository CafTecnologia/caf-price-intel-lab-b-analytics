import { PrismaClient } from "@prisma/client";
import { config as loadDotenv } from "dotenv";

loadDotenv();

declare global {
  // eslint-disable-next-line no-var
  var __aiFirstPrismaClient__: PrismaClient | undefined;
}

function normalizePrismaDatabaseUrl(): string | null {
  const explicitUrl = process.env.PRISMA_DATABASE_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const sharedUrl = process.env.DATABASE_URL?.trim();
  if (!sharedUrl) {
    return null;
  }

  if (sharedUrl.startsWith("postgresql+psycopg://")) {
    return sharedUrl.replace("postgresql+psycopg://", "postgresql://");
  }

  return sharedUrl;
}

export function resolvePrismaDatabaseUrl(): string {
  const url = normalizePrismaDatabaseUrl();
  if (!url) {
    throw new Error("PRISMA_DATABASE_URL is not configured. Set PRISMA_DATABASE_URL or a compatible DATABASE_URL.");
  }

  return url;
}

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: resolvePrismaDatabaseUrl(),
      },
    },
  });
}

export function getPrismaClient(): PrismaClient {
  if (!globalThis.__aiFirstPrismaClient__) {
    globalThis.__aiFirstPrismaClient__ = createPrismaClient();
  }

  return globalThis.__aiFirstPrismaClient__;
}
