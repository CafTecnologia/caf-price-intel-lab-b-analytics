# Handoff Para Otro Agente

## Que es esta app

Esta app es el **Simulador Financiero - Oferta Economica**.

Es una calculadora deterministica independiente. No usa IA, no llama Gemini y no extrae documentos. Recibe datos desde otra app, Excel o carga manual, y calcula:

- costo minimo;
- costo promedio;
- costo moderado;
- costo manual;
- oferta unitaria;
- oferta total;
- utilidad;
- margen;
- alertas;
- resumen total;
- resumen parcial evaluable.

## Ubicacion

VPS DEV:

```text
/opt/caf-dev/repos/caf-price-intel-lab-b-analytics/apps/financial-offer-web
```

URL DEV:

```text
http://127.0.0.1:18030/
```

## Regla central

La app no investiga precios. La app que la alimente debe entregar los datos.

La forma recomendada de integracion es:

1. Otro sistema genera JSON.
2. Hace `POST /api/import`.
3. Esta app guarda el calculo.
4. Devuelve `{ calculationId, url }`.
5. El usuario abre la URL y ajusta oferta.

## Contrato vigente, sin ambiguedad

Para nuevas integraciones, el JSON debe usar:

- `calculation`: datos generales del calculo.
- `items`: items a simular.
- `settings`: parametros globales opcionales.

No uses nombres historicos del codigo como contrato.

No pidas a otra app que envie costos calculados. La forma vigente es enviar `price_sources` con precios unitarios, moneda, URL y notas. Esta app calcula internamente minimo, promedio, moderado, costo aplicado, oferta, utilidad, margen, estados y alertas.

Si ves campos adicionales en `lib/contract.ts`, no significa que sean el contrato recomendado. Estan ahi para compatibilidad, UI interna o pruebas.

Tampoco pidas a la ingesta normal modos de costo, modos de oferta, descuentos, utilidad, margen, IVA operativo ni costos calculados. Eso vive dentro de la calculadora y no debe contaminar el contrato publico.

## Endpoint principal

```text
POST /api/import
```

Payload base:

```json
{
  "version": 1,
  "calculation": {
    "name": "Calculo oferta"
  },
  "items": [
    {
      "item": "1",
      "description": "Nombre del item",
      "technical_description": "Ficha tecnica",
      "quantity": 1,
      "unit": "UND",
      "reference_unit": 100000,
      "price_sources": [
        {
          "name": "Proveedor A",
          "unit_price": 70000,
          "currency": "COP",
          "url": "https://example.com"
        }
      ]
    }
  ],
  "settings": {
    "usd_to_cop_rate": 4000
  }
}
```

## Campos importantes

`reference_unit`: precio techo unitario.

`price_sources`: fuentes de costo. La app acepta hasta 3 fuentes, aunque tecnicamente puede recibir mas.

Con esos datos la app calcula minimo, promedio, moderado, costo aplicado, oferta, utilidad, margen, estados y alertas.

## USD

Para fuentes USD:

```text
COP = unit_price * TRM * (1 + import_pct / 100)
```

Usa `source.trm` si viene. Si no viene, usa `settings.usd_to_cop_rate`.

Usa `source.import_pct` si viene. Si no viene, usa `settings.usd_import_pct`, normalmente 30.

## Resumenes

La app no debe engañar al usuario:

- Total completo solo cuando todos los items tienen datos suficientes.
- Parcial evaluable solo con items completos.
- Si falta costo o precio techo, el total se mantiene pendiente.

## Ejemplo por defecto

En la pantalla principal, el boton `Usar ejemplo` carga `Laboratorio de calculo financiero`.

Ese ejemplo trae 8 items y cubre:

- fuentes COP;
- fuente USD;
- importacion 30%;
- costo manual;
- oferta por descuento;
- oferta por utilidad objetivo;
- oferta manual;
- item sin costo;
- item sin techo;
- costo mayor al techo;
- IVA exento.

## Validaciones

Antes de cambiar o desplegar:

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
```

## Despliegue DEV

Usar `docs/DEPLOY_DEV.md`.

No tocar produccion.
