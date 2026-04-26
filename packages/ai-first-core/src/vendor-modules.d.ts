declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
  }

  export default function pdfParse(data: Buffer): Promise<PdfParseResult>;
}

declare module "json2csv" {
  export class Parser<T = Record<string, unknown>> {
    parse(rows: T[]): string;
  }
}

declare module "better-sqlite3" {
  interface Statement {
    run(params?: Record<string, unknown>): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }

  export interface Database {
    pragma(value: string): void;
    exec(sql: string): void;
    prepare(sql: string): Statement;
  }

  export default class BetterSqlite3Database implements Database {
    constructor(filename: string);
    pragma(value: string): void;
    exec(sql: string): void;
    prepare(sql: string): Statement;
  }
}
