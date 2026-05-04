# Handoff Para Otro Agente

## Que es esta app

Esta app es la capa de extraccion IA por etapas de la suite CAF.

Su rol es:
- recibir archivos o contexto documental
- ejecutar extraccion y estructuracion por etapas (Etapa 1, 2 y 3)
- producir datos normalizados reutilizables
- alimentar al simulador financiero (Etapa 4)

No reemplaza al simulador financiero. No debe absorber calculos financieros
internos que ya pertenecen a financial-offer-web.

## Ubicacion canonica

VPS DEV:

```
/opt/caf-dev/repos/caf-price-intel-lab-b-analytics/apps/ia-stages-web
```

URL DEV: http://127.0.0.1:18031

La PC local se usa como cliente (SSH, navegador, tunel). No es la fuente de verdad.

## Estado actual (actualizado 2026-05-03)

- Multi-proveedor operativo: Gemini y DeepSeek configurables por etapa
- Modelo y proveedor distintos por etapa (Etapa 1, 2, 3)
- Etapa 4 live: al completar el analisis financiero, la app envia el JSON a
  financial-offer-web (POST /api/import) y redirige automaticamente a
  /finanzas?calc={id}
- /finanzas: embed del simulador financiero con deteccion de CSP y fallback
- Historial de corridas: SQLite en /data/runs.db via /api/runs
- Perfiles de prompt por proveedor: lib/prompt-profiles.ts

## Motor IA configurable

Proveedores soportados: Gemini (Google) y DeepSeek.

Configuracion via .env.local:

```
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-v4-flash
AI_PROVIDER=gemini
AI_PROVIDER_STAGE1=gemini
AI_PROVIDER_STAGE2=gemini
AI_PROVIDER_STAGE3=gemini
AI_MODEL_STAGE1=
AI_MODEL_STAGE2=
AI_MODEL_STAGE3=
```

Si AI_PROVIDER_STAGEx esta vacio, la etapa hereda el proveedor global.
Si AI_MODEL_STAGEx esta vacio, la etapa usa el modelo global del proveedor.

## Relacion con la suite

- Extraccion IA por etapas: esta app (18031)
- Simulador financiero deterministico: apps/financial-offer-web (18030)
- Odoo clone: punto de integracion y validacion previa a produccion (18069)

## Contrato conceptual hacia el simulador

Esta app produce por item:
- descripcion, ficha tecnica, cantidad, unidad
- precio techo unitario (reference_unit)
- fuentes de precio (price_sources): moneda, valor unitario, URL, notas

No envia costos calculados, modos de costo, utilidad ni margen.
Eso vive en financial-offer-web.

## Validaciones minimas

Antes de cerrar trabajo:

```bash
cd /opt/caf-dev/repos/caf-price-intel-lab-b-analytics/apps/ia-stages-web
npm run typecheck
npm run build
curl -I http://127.0.0.1:18031/
```
