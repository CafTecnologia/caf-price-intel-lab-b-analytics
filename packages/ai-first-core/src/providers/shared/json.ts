function repairJsonStringControls(text: string): string {
  let result = "";
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (isEscaped) {
      result += char;
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      isEscaped = true;
      continue;
    }

    if (char === "\"") {
      result += char;
      inString = !inString;
      continue;
    }

    if (inString && (char === "\n" || char === "\r" || char === "\t")) {
      result += char === "\t" ? "\\t" : "\\n";
      continue;
    }

    result += char;
  }

  return result;
}

function repairTruncatedTopLevelArray(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[")) {
    return null;
  }

  let inString = false;
  let isEscaped = false;
  let arrayDepth = 0;
  let objectDepth = 0;
  let lastCompletedObjectIndex = -1;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      isEscaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "[") {
      arrayDepth += 1;
      continue;
    }

    if (char === "]") {
      arrayDepth -= 1;
      if (arrayDepth === 0 && objectDepth === 0) {
        return trimmed;
      }
      continue;
    }

    if (char === "{") {
      objectDepth += 1;
      continue;
    }

    if (char === "}") {
      objectDepth -= 1;
      if (arrayDepth === 1 && objectDepth === 0) {
        lastCompletedObjectIndex = index;
      }
    }
  }

  if (lastCompletedObjectIndex < 0) {
    return null;
  }

  return `${trimmed.slice(0, lastCompletedObjectIndex + 1)}]`;
}

export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const controlRepaired = repairJsonStringControls(text);
    if (controlRepaired !== text) {
      try {
        return JSON.parse(controlRepaired);
      } catch {
        const truncatedArrayAfterControlRepair = repairTruncatedTopLevelArray(controlRepaired);
        if (truncatedArrayAfterControlRepair && truncatedArrayAfterControlRepair !== controlRepaired) {
          return JSON.parse(truncatedArrayAfterControlRepair);
        }
      }
    }

    const truncatedArrayRepaired = repairTruncatedTopLevelArray(text);
    if (truncatedArrayRepaired && truncatedArrayRepaired !== text) {
      return JSON.parse(truncatedArrayRepaired);
    }

    throw error;
  }
}

export function extractJsonBlock(text: string): string {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }

  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  const startCandidates = [firstBrace, firstBracket].filter((value) => value >= 0);

  if (startCandidates.length === 0) {
    throw new Error("No JSON block found in provider response");
  }

  const start = Math.min(...startCandidates);
  const opening = trimmed[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;

  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === opening) {
      depth += 1;
    } else if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(start, index + 1);
      }
    }
  }

  throw new Error("Unterminated JSON block in provider response");
}

export function parseJsonFromText(text: string): unknown {
  return safeJsonParse(extractJsonBlock(text));
}
