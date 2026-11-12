import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

const execFileAsync = promisify(execFile);

type Cell = XLSX.CellObject & { s?: Record<string, unknown>; c?: Array<{ t: string }> };

const columns = [
  "Item",
  "Nombre",
  "Descripción",
  "Und de medida",
  "Cant",
  "Precio techo unitario",
  "Notas del ítem",
  "Proveedor 1",
  "Precio proveedor 1",
  "Moneda proveedor 1",
  "URL proveedor 1",
  "Notas proveedor 1",
  "TRM proveedor 1",
  "Proveedor 2",
  "Precio proveedor 2",
  "Moneda proveedor 2",
  "URL proveedor 2",
  "Notas proveedor 2",
  "TRM proveedor 2",
  "Proveedor 3",
  "Precio proveedor 3",
  "Moneda proveedor 3",
  "URL proveedor 3",
  "Notas proveedor 3",
  "TRM proveedor 3",
  "Tiene costo asociado",
  "Servicio o costo asociado",
  "Valor costo asociado",
  "Tipo costo asociado",
  "Aplicación costo asociado",
];

const exampleRows = [
  [
    "1",
    "Taladro profesional",
    "Taladro 1/2 pulg, uso profesional, velocidad variable.",
    "UND",
    2,
    350000,
    "Revisar garantía mínima solicitada.",
    "Proveedor A",
    210000,
    "COP",
    "https://proveedor-a.example/taladro",
    "Producto comparable",
    "",
    "Proveedor B",
    240000,
    "COP",
    "https://proveedor-b.example/taladro",
    "Incluye IVA",
    "",
    "Proveedor USA",
    55,
    "USD",
    "https://store.example/tool",
    "Requiere importación",
    4000,
    "Sí",
    "Instalación",
    30000,
    "service",
    "fixed",
  ],
  [
    "2",
    "Caja de tornillos galvanizados",
    "Caja x 100 unidades.",
    "CAJA",
    5,
    42000,
    "",
    "Proveedor local",
    28000,
    "COP",
    "",
    "",
    "",
    "Ecommerce",
    31000,
    "COP",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ],
];

const groupRow = [
  "Datos del ítem",
  "",
  "",
  "",
  "",
  "",
  "",
  "Fuente 1",
  "",
  "",
  "",
  "",
  "",
  "Fuente 2",
  "",
  "",
  "",
  "",
  "",
  "Fuente 3",
  "",
  "",
  "",
  "",
  "",
  "Costos asociados",
  "",
  "",
  "",
  "",
];

const columnHelp: Array<[string, string, string]> = [
  ["Obligatorio", "Nombre", "Nombre corto del producto o servicio. Sin esto la fila no se importa."],
  ["Recomendado", "Und de medida", "Unidad: UND, M, KG, HORA, CAJA, etc."],
  ["Recomendado", "Cant", "Cantidad para calcular totales."],
  ["Recomendado", "Precio techo unitario", "Precio máximo unitario permitido o presupuesto unitario."],
  ["Recomendado", "Proveedor 1/2/3", "Nombre de proveedor, tienda o fuente. Idealmente diligenciar 1 a 3 fuentes."],
  ["Recomendado", "Precio proveedor 1/2/3", "Precio unitario encontrado en esa fuente."],
  ["Recomendado", "Moneda proveedor 1/2/3", "COP o USD. Si queda vacío, la app asume COP."],
  ["Opcional", "Item", "Número o código visible del ítem."],
  ["Opcional", "Descripción", "Ficha técnica o detalle ampliado."],
  ["Opcional", "URL proveedor 1/2/3", "Link de trazabilidad."],
  ["Opcional", "Notas proveedor 1/2/3", "Comparabilidad, alerta o comentario útil."],
  ["Opcional", "TRM proveedor 1/2/3", "Solo si la fuente está en USD y trae TRM propia."],
  ["Opcional", "Tiene costo asociado", "Sí cuando el ítem requiere un servicio o costo extra. Sin valor se deja pendiente."],
  ["Opcional", "Servicio o costo asociado", "Nombre del servicio o costo de este ítem."],
  ["Opcional", "Valor costo asociado", "Valor numérico del costo extra; vacío deja un costo pendiente."],
  ["Opcional", "Tipo costo asociado", "service, logistics u other."],
  ["Opcional", "Aplicación costo asociado", "fixed una vez o per_unit por unidad."],
  ["Opcional", "Costos generales", "Registrar en la segunda hoja los costos de todo el proyecto, no repetirlos por ítem."],
  ["Opcional", "Notas del ítem", "Comentarios generales del ítem."],
];

const fills = {
  item: "EAF2F8",
  source1: "E9F7EF",
  source2: "FFF6D7",
  source3: "EAF0FF",
  costs: "F3EAF6",
  required: "FDEDEC",
  recommended: "E8F6F3",
  optional: "F4F6F7",
};

function styleCell(sheet: XLSX.WorkSheet, address: string, fill: string, bold = false) {
  const cell = sheet[address] as Cell | undefined;
  if (!cell) return;
  cell.s = {
    fill: { fgColor: { rgb: fill } },
    font: { bold, color: { rgb: "1F2933" } },
    alignment: { vertical: "center", wrapText: true },
  };
}

function addComment(sheet: XLSX.WorkSheet, address: string, text: string) {
  const cell = sheet[address] as Cell | undefined;
  if (!cell) return;
  cell.c = [{ t: text }];
}

function buildTemplateWorkbook() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([groupRow, columns, ...exampleRows]);

  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: 0, c: 7 }, e: { r: 0, c: 12 } },
    { s: { r: 0, c: 13 }, e: { r: 0, c: 18 } },
    { s: { r: 0, c: 19 }, e: { r: 0, c: 24 } },
    { s: { r: 0, c: 25 }, e: { r: 0, c: 29 } },
  ];
  sheet["!cols"] = [
    { wch: 10 },
    { wch: 30 },
    { wch: 46 },
    { wch: 14 },
    { wch: 10 },
    { wch: 20 },
    { wch: 32 },
    ...Array.from({ length: 3 }).flatMap(() => [
      { wch: 24 },
      { wch: 18 },
      { wch: 16 },
      { wch: 34 },
      { wch: 30 },
      { wch: 16 },
    ]),
    { wch: 20 }, { wch: 28 }, { wch: 22 }, { wch: 22 }, { wch: 26 },
  ];
  sheet["!autofilter"] = { ref: "A2:AD2" };

  for (let c = 0; c < columns.length; c++) {
    const letter = XLSX.utils.encode_col(c);
    const fill = c <= 6 ? fills.item : c <= 12 ? fills.source1 : c <= 18 ? fills.source2 : c <= 24 ? fills.source3 : fills.costs;
    styleCell(sheet, `${letter}1`, fill, true);
    styleCell(sheet, `${letter}2`, columns[c] === "Nombre" ? fills.required : fill, true);
  }

  addComment(sheet, "B2", "Obligatorio. Nombre corto del ítem.");
  addComment(sheet, "D2", "Recomendado. Unidad de medida: UND, M, KG, HORA, CAJA.");
  addComment(sheet, "E2", "Recomendado. Cantidad para calcular totales.");
  addComment(sheet, "F2", "Recomendado. Precio techo unitario.");
  addComment(sheet, "H2", "Recomendado. Nombre del proveedor o fuente 1.");
  addComment(sheet, "I2", "Recomendado. Precio unitario de la fuente 1.");
  addComment(sheet, "J2", "Recomendado. COP o USD. Si queda vacío, se asume COP.");

  XLSX.utils.book_append_sheet(workbook, sheet, "Carga de items");

  const generalCosts = XLSX.utils.aoa_to_sheet([
    ["Nombre", "Categoría", "Valor", "Nota"],
    ["Póliza global", "other", 15000, "Ejemplo: se suma una vez al costo del proyecto"],
  ]);
  generalCosts["!cols"] = [{ wch: 30 }, { wch: 20 }, { wch: 18 }, { wch: 56 }];
  generalCosts["!autofilter"] = { ref: "A1:D1" };
  for (const address of ["A1", "B1", "C1", "D1"]) styleCell(generalCosts, address, fills.costs, true);
  XLSX.utils.book_append_sheet(workbook, generalCosts, "Costos generales");

  const guide = XLSX.utils.aoa_to_sheet([
    ["Grupo", "Columna", "Qué escribir"],
    ...columnHelp,
    [],
    ["Regla", "", "La app no pide fuente elegida, modo de costo/oferta, costos calculados, totales, utilidad, margen, descuentos ni costo manual. Eso se decide o calcula en el simulador."],
  ]);
  guide["!cols"] = [{ wch: 18 }, { wch: 28 }, { wch: 90 }];
  for (const address of ["A1", "B1", "C1"]) styleCell(guide, address, "D6EAF8", true);
  XLSX.utils.book_append_sheet(workbook, guide, "Instrucciones");

  return workbook;
}

async function styleTemplateBuffer(buffer: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "financial-offer-template-"));
  const filePath = join(dir, "plantilla-simulador-financiero.xlsx");
  try {
    await writeFile(filePath, buffer);
    await execFileAsync("python3", [resolve(process.cwd(), "scripts/style-template-xlsx.py"), filePath]);
    return await readFile(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function GET() {
  const workbook = buildTemplateWorkbook();
  const rawBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const buffer = await styleTemplateBuffer(rawBuffer);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-simulador-financiero.xlsx"',
    },
  });
}
