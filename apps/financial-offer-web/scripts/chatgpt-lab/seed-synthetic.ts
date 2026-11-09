import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { normalizeImportPayload, toCalculation } from "../../lib/contract";
import { buildInitialOfferControls, buildSimulation } from "../../lib/financial-engine";

// Los UUID forman una allowlist del laboratorio. Ninguno corresponde a Odoo.
const cases = [
  {
    id: "e9b8d9ea-833c-4749-a254-08d2032ad219", process: "DEMO-CAF-2026-001",
    title: "Aula STEM escolar", entity: "Entidad ficticia de educación",
    settings: { vat_rate: 19, default_margin: 20, default_cost_mode: "weighted" },
    items: [
      product("1", "Kit de sensores educativos", "Sensor de temperatura, luz y movimiento; incluye interfaz USB.", 12, 480000, [300000, 330000, 345000]),
      product("2", "Tableta de apoyo didáctico", "Pantalla de 10 pulgadas, memoria 64 GB, funda de protección.", 12, 850000, [550000, 610000, 640000]),
      product("3", "Maleta de almacenamiento", "Maleta rígida para 12 kits con separadores internos.", 2, 720000, [420000, 455000]),
      product("4", "Cableado de laboratorio", "Juego de cables, adaptadores y accesorios por aula.", 4, 280000, [160000, 175000]),
    ],
    general_costs: [{ id: "general-001", name: "Póliza de cumplimiento ficticia", category: "other", amount: 220000, notes: "Dato inventado para prueba." }],
  },
  {
    id: "aa43e36c-48e4-429d-ab49-81d3866ddd8b", process: "DEMO-CAF-2026-002",
    title: "Red de oficina regional", entity: "Entidad ficticia de conectividad",
    settings: { vat_rate: 19, default_margin: 18, default_cost_mode: "weighted", usd_to_cop_rate: 4100, usd_import_pct: 25 },
    items: [
      product("1", "Switch administrable 24 puertos", "Gigabit, PoE, montaje en rack.", 5, 2300000, [1350000, 1490000, 1780000]),
      product("2", "Punto de acceso inalámbrico", "Wi-Fi 6, alimentación PoE, gestión central.", 18, 980000, [570000, 640000]),
      product("3", "Gabinete de comunicaciones", "Gabinete mural de 12U con ventilación.", 3, 1500000, [890000, 970000]),
      {
        ...product("4", "Módulo óptico", "Transceptor de fibra monomodo, 10 Gb/s.", 8, 690000, [390000, 430000]),
        price_sources: [
          { id: "red-4-a", name: "Fuente sintética USD", unit_price: 82, currency: "USD", trm: 4100, import_pct: 25, notes: "No es una cotización real." },
          { id: "red-4-b", name: "Fuente sintética COP", unit_price: 430000, currency: "COP", notes: "No es una cotización real." },
        ],
        additional_costs: [{ id: "red-transporte", name: "Transporte entre sedes", category: "logistics", mode: "fixed", amount: 350000, review_status: "included", notes: "Valor inventado para prueba." }],
      },
    ],
    general_costs: [{ id: "general-002", name: "Imprevistos logísticos ficticios", category: "logistics", amount: 180000, notes: "Dato inventado para prueba." }],
  },
  {
    id: "6f89ce1a-d5d0-44db-947e-62828b9efc32", process: "DEMO-CAF-2026-003",
    title: "Soporte e instalación", entity: "Entidad ficticia de servicios",
    settings: { vat_rate: 19, default_margin: 15, default_cost_mode: "manual" },
    items: [
      service("1", "Instalación en sitio", "Jornada de instalación y pruebas de aceptación.", 20, 240000),
      service("2", "Bolsa de soporte técnico", "Atención remota de incidentes, por hora.", 80, 120000),
      service("3", "Capacitación de usuarios", "Sesión grupal con material didáctico.", 6, 650000),
    ],
    general_costs: [],
  },
  {
    id: "d81fda0a-87cb-4cbb-80f8-bfa7f25715b4", process: "DEMO-CAF-2026-004",
    title: "Dotación de laboratorio", entity: "Entidad ficticia de investigación",
    settings: { vat_rate: 19, default_margin: 18, default_cost_mode: "weighted", manual_reference_total: 22500000 },
    items: [
      product("1", "Microscopio binocular", "Aumento variable, iluminación LED.", 4, 2400000, [1490000, 1600000, 1710000]),
      product("2", "Balanza de precisión", "Capacidad 2 kg, resolución 0,01 g.", 4, 1800000, [990000, 1100000]),
      product("3", "Equipo de medición multiparámetro", "Mide pH, conductividad y temperatura.", 3, 2100000, [1250000, 1380000]),
      product("4", "Consumibles de laboratorio", "Lote de recipientes, guantes y reactivos de demostración.", 10, null, [290000, 320000]),
      product("5", "Armario de seguridad", "Gabinete metálico con cerradura y ventilación.", 2, 1250000, [710000, 760000]),
    ],
    general_costs: [{ id: "general-004", name: "Seguro de transporte ficticio", category: "logistics", amount: 300000, notes: "Dato inventado para prueba." }],
  },
] as const;

function product(item: string, description: string, technical_description: string, quantity: number, reference_unit: number | null, prices: number[]) {
  return {
    item, description, technical_description, quantity, unit: "UND", reference_unit,
    deliverable_type: "product", selected_cost_mode: "weighted", offer_mode: "discount", discount_pct: 5,
    manual_offer_unit: reference_unit === null ? null : reference_unit * 0.95,
    price_sources: prices.map((unit_price, index) => ({ id: `p-${item}-${index + 1}`, name: `Fuente ficticia ${index + 1}`, unit_price, currency: "COP", notes: "Precio inventado para prueba; no constituye cotización." })),
    notes: "Caso sintético. Verificar especificaciones y costo real antes de usar en una oferta.",
  };
}

function service(item: string, description: string, technical_description: string, quantity: number, reference_unit: number) {
  return {
    item, description, technical_description, quantity, unit: "HORA", reference_unit,
    deliverable_type: "service", selected_cost_mode: "manual", manual_unit_cost: null,
    offer_mode: "profit", profit_pct: 15,
    additional_costs: [{ id: `service-${item}-pending`, name: "Costo de prestación pendiente", category: "service", mode: "per_unit", amount: null, review_status: "suggested", notes: "Requiere valoración humana." }],
    notes: "Servicio de prueba; costo pendiente deliberadamente.",
  };
}

const destination = process.argv[2];
if (!destination || !path.isAbsolute(destination)) throw new Error("Indica un destino absoluto nuevo para el fixture.");
const now = new Date().toISOString();
const projects = cases.map((entry) => {
  const input = normalizeImportPayload({
    version: 1,
    calculation: {
      external_id: `caf-chatgpt-synthetic:${entry.id}`,
      source_system: "caf_chatgpt_synthetic",
      source_analysis_id: `analisis-${entry.process}`,
      ia_run_id: `corrida-${entry.process}`,
      odoo_project_name: `${entry.title} · proyecto ficticio`,
      odoo_process_number: entry.process,
      odoo_entity_name: entry.entity,
      name: `[PRUEBAS ChatGPT] ${entry.process} · ${entry.title}`,
      entity: entry.entity, currency: "COP",
    },
    items: entry.items,
    settings: entry.settings,
    general_costs: entry.general_costs,
  });
  const project = toCalculation(input, entry.id, now);
  const simulation = buildSimulation(project, buildInitialOfferControls(project));
  if (simulation.rows.length !== project.items.length || project.odooProjectId !== null || project.odooDb !== null) {
    throw new Error(`Fixture inválido: ${entry.process}`);
  }
  for (const [index, item] of project.items.entries()) {
    if (item.offerMode === "discount" && item.referenceUnit !== null) {
      const expectedOffer = item.referenceUnit * (1 - (item.discountPct ?? 0) / 100);
      if (Math.abs((simulation.rows[index]?.offerUnit ?? NaN) - expectedOffer) > 0.01) {
        throw new Error(`Descuento inconsistente: ${entry.process}, renglón ${index + 1}`);
      }
    }
  }
  return project;
});

const store = {
  projects, scenarios: [], priceBaseVersions: [], priceBaseReceipts: {},
  importReceipts: {}, deletionReceipts: {}, versionActionReceipts: {},
  calculationOperationReceipts: {}, analysisScenarios: [], analysisActionReceipts: {},
  manualChangeReceipts: [],
  financialDefaults: { applyReteFuente: false, reteFuenteRate: 2.5, reteFuenteBase: "pre_vat",
    applyReteIva: false, reteIvaRate: 15, reteIvaBase: "vat",
    applyReteIca: false, reteIcaRate: 0, reteIcaBase: "pre_vat" },
};
const body = `${JSON.stringify(store)}\n`;
await mkdir(path.dirname(destination), { recursive: true });
const handle = await open(destination, "wx", 0o600);
try { await handle.writeFile(body); } finally { await handle.close(); }
process.stdout.write(JSON.stringify({ count: projects.length, ids: projects.map((p) => p.id),
  itemCounts: projects.map((p) => p.items.length), sha256: createHash("sha256").update(body).digest("hex") }) + "\n");
