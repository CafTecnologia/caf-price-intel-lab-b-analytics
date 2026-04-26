import { OdooImportPreviewSchema } from "./dtos";

export interface OdooAiFirstClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export class OdooAiFirstClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: OdooAiFirstClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getImportPreview(documentId: string) {
    const response = await this.fetchImpl(`${this.baseUrl}/api/documents/${documentId}`);
    if (!response.ok) {
      throw new Error(`Could not load AI-first document ${documentId}: ${response.status}`);
    }

    const payload = (await response.json()) as { odooPreview?: unknown; document?: unknown };
    return OdooImportPreviewSchema.parse(payload.odooPreview);
  }

  async downloadJson(documentId: string) {
    const response = await this.fetchImpl(`${this.baseUrl}/api/documents/${documentId}/export?format=json`);
    if (!response.ok) {
      throw new Error(`Could not download JSON export for ${documentId}: ${response.status}`);
    }

    return response.text();
  }
}
