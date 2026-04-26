import { createHash } from "node:crypto";

export function buildPromptChecksum(input: {
  key: string;
  version: string;
  systemInstructions: string;
  userTemplate: string;
  responseSchemaName: string;
}): string {
  return createHash("sha256")
    .update(
      [
        input.key,
        input.version,
        input.systemInstructions,
        input.userTemplate,
        input.responseSchemaName,
      ].join("\n---\n"),
      "utf8",
    )
    .digest("hex");
}
