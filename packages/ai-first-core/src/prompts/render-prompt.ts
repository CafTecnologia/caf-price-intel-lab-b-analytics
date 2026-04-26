export function renderPromptTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    return key in variables ? variables[key] : match;
  });
}

export function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
