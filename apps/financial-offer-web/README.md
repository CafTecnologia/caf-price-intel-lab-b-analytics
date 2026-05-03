# Simulador Financiero

**Simulador Financiero** es el componente determinístico de la **Suite de análisis técnico y financiero**: recibe JSON (u otras cargas), simula costos, oferta económica y utilidad desde datos entregados por **Extracción de datos estratégicos**, otra app o carga manual.

No usa IA, no llama Gemini y no extrae documentos. Su trabajo es recibir ítems, fuentes de precio, precio techo y cantidades; después calcula escenarios y permite ajustar la oferta.

## Concepto

- Cada registro guardado es un **calculo** o **borrador**, no un proyecto.
- El `id` interno sirve para abrir, guardar y exportar.
- Por ahora no se asocia a Odoo, App B ni ningun proceso externo.
- Por defecto los precios llegan en COP y con IVA incluido.
- Puede usarse en modo 100% manual: crear borrador, agregar filas y escribir los datos editables.
- Puede recibir datos desde cualquier otra app mediante JSON/API o plantilla Excel.

## Costos

La app ya no necesita que otro sistema envie costos prepromediados.

Cada item puede traer hasta 3 fuentes de precio:

- precio unitario;
- moneda `COP` o `USD`;
- URL o proveedor;
- TRM e importacion opcionales por fuente.

Con esas fuentes la app calcula:

- **Costo minimo**: menor precio valido normalizado a COP.
- **Costo promedio**: promedio simple de fuentes validas.
- **Costo moderado**: promedio entre costo minimo y costo promedio.
- **Costo manual**: valor escrito por el usuario, si quiere reemplazar o completar.

Si una fuente llega en USD, se normaliza asi:

```text
precio_usd * TRM * (1 + import_pct / 100)
```

El `import_pct` por defecto es 30%.

## Oferta

La oferta siempre se entiende como una operacion sobre el precio techo unitario o sobre el costo, segun el modo:

- `discount`: oferta = precio techo - descuento.
- `profit`: oferta = costo aplicado + utilidad objetivo.
- `manual`: oferta = valor unitario escrito por el usuario.

Si no hay ajuste explicito, el modo por defecto es `discount` con `0%`, por lo que la oferta queda igual al precio techo.

## Resumenes

La app separa dos lecturas para no mezclar datos incompletos:

- **Resumen total**: se activa cuando todos los items tienen cantidad, costo aplicado, precio techo y oferta.
- **Resumen parcial evaluable**: usa solo las filas completas, para que el usuario pueda trabajar sin confundir parcial con total.

La barra grafica muestra la composicion de la oferta entre costo y utilidad, incluyendo porcentaje de cada parte.

## Endpoints

- `POST /api/import`: importa o actualiza un calculo.
- `POST /api/validate`: valida un JSON sin guardarlo.
- `GET /api/projects`: lista calculos guardados. Nombre legacy por compatibilidad.
- `POST /api/projects`: crea un calculo manual basico.
- `GET /api/projects/{id}`: obtiene un calculo.
- `PATCH /api/projects/{id}`: guarda cambios del calculo.
- `GET /api/projects/{id}/export?format=json`: exporta calculo, simulacion y oferta.
- `GET /api/projects/{id}/export?format=csv`: exporta filas de simulacion.
- `GET /api/template`: descarga plantilla Excel.

## Documentacion

- [Guia de ingesta](docs/INGESTION.md): explicacion para personas, API y Excel.
- [Contrato tecnico](docs/API_CONTRACT.md): campos y ejemplos para integraciones.
- [Carga manual y Excel](docs/MANUAL_EXCEL.md): como llenar datos sin IA.
- [Despliegue DEV](docs/DEPLOY_DEV.md): como subir esta app al VPS de desarrollo.
- [Handoff para agentes](docs/AGENT_HANDOFF.md): contexto compacto para otro agente.

## Payload JSON minimo

```json
{
  "version": 1,
  "calculation": {
    "name": "Oferta ferreteria"
  },
  "items": [
    {
      "item": "1",
      "description": "Taladro percutor profesional",
      "technical_description": "Taladro 1/2 pulg, uso profesional, velocidad variable.",
      "quantity": 2,
      "unit": "UND",
      "reference_unit": 350000,
      "price_sources": [
        {
          "name": "Proveedor A",
          "unit_price": 210000,
          "currency": "COP",
          "url": "https://proveedor.example/a"
        },
        {
          "name": "Proveedor USA",
          "unit_price": 55,
          "currency": "USD",
          "url": "https://store.example/tool"
        }
      ]
    }
  ],
  "settings": {
    "usd_to_cop_rate": 4000
  }
}
```

Ese es el contrato minimo recomendado. La app calcula el resto: minimo, promedio, moderado, oferta base, utilidad, margen y alertas.

Tambien acepta columnas planas `source_1_name`, `source_1_price`, `source_1_currency`, etc. para Excel.

## IVA

Modos por item:

- `included`: el precio ya trae IVA incluido. La app lo descompone.
- `excluded`: el precio llega sin IVA. La app suma IVA para volverlo comparable.
- `exempt`: no aplica IVA.

## Resumen total y parcial

La app separa:

- **Resumen total**: solo se desbloquea cuando todos los items tienen cantidad, costo, precio techo y oferta.
- **Resumen parcial evaluable**: muestra solo los items completos.

Esto evita mostrar costos parciales como si fueran totales.

## Validacion local

```bash
npm run test
npx tsc --noEmit
npm run build
```

## Entorno DEV actual

- VPS DEV: `51.178.143.231`
- Ruta en VPS: `/opt/caf-dev/repos/caf-price-intel-lab-b-analytics/apps/financial-offer-web`
- Contenedor: `caf-dev-app-financial-offer-web`
- URL por tunel local: `http://127.0.0.1:18030/`
