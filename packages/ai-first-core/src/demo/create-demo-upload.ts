import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

const outputPath = resolve(
  process.cwd(),
  "demo",
  "ai-first",
  "sample-official-items.xlsx",
);

const workbook = XLSX.utils.book_new();
const worksheet = XLSX.utils.aoa_to_sheet([
  ["LISTADO OFICIAL DE ITEMS Y PRECIOS DE REFERENCIA"],
  [],
  ["Nro Item", "Descripcion", "Ficha Tecnica", "Cantidad", "Unidad", "Precio Unit", "Precio Total", "Moneda"],
  [
    "1",
    "Laptop empresarial 14 pulgadas",
    "Intel Core i7, 16GB RAM, SSD 512GB, Wi-Fi 6",
    12,
    "unidad",
    1250,
    15000,
    "USD",
  ],
  [
    "2",
    "Monitor LED 24 pulgadas",
    "Resolucion Full HD, HDMI, soporte VESA",
    12,
    "unidad",
    210,
    2520,
    "USD",
  ],
  [
    "3",
    "Mouse inalambrico ergonomico",
    "Conectividad 2.4GHz, bateria AA incluida",
    12,
    "unidad",
    18,
    216,
    "USD",
  ],
  [
    "4",
    "Servicio de instalacion y puesta en marcha",
    "Incluye configuracion inicial y pruebas de funcionamiento",
    1,
    "servicio",
    480,
    480,
    "USD",
  ],
]);

worksheet["!cols"] = [
  { wch: 12 },
  { wch: 36 },
  { wch: 46 },
  { wch: 10 },
  { wch: 12 },
  { wch: 14 },
  { wch: 14 },
  { wch: 10 },
];

XLSX.utils.book_append_sheet(workbook, worksheet, "Listado");
mkdirSync(dirname(outputPath), { recursive: true });
XLSX.writeFile(workbook, outputPath);

console.log(`Demo upload created at ${outputPath}`);
