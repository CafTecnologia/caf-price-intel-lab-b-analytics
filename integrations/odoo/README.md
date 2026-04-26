# Odoo 19 integration prep

This folder prepares the AI-first ingestion core for a future Odoo 19 adapter without embedding the AI pipeline inside Odoo itself.

## Design stance

Odoo should act as:

- launcher
- reviewer
- mapper
- persistence consumer

The AI-first ingestion core should remain:

- provider-agnostic
- batch-aware
- auditable
- callable from outside the web UI

## Planned Odoo 19 shape

### Wizard entrypoint

- a `TransientModel` receives the uploaded file or attachment reference
- the wizard calls the standalone ingestion API
- the wizard polls status and shows a preview before final import

### Persistent models

- header model for the processed document
- One2many line model for normalized items
- `ir.attachment` linkage for the original source file and exported JSON
- audit log model or mirrored summary fields for confidence and warnings

### Actions

- `ir.actions.act_window` with `target="new"` for the wizard dialog
- optional `binding_model_id` so the action appears in a list/form context
- optional `ir.actions.client` for a richer preview experience if needed later

## What already exists in this phase

- DTOs in `src/dtos.ts`
- preview mapping in `src/mappers.ts`
- standalone client in `src/client.ts`
- example payload in `examples/import-preview.json`
- architecture references in `docs/ai-first-phase-1-architecture.md`

## Implementation principle

Odoo does not parse documents semantically.
Odoo consumes validated DTOs and presents review/approval UX.

## Minimal Odoo-side consumption flow

1. A wizard uploads or references an `ir.attachment`.
2. Odoo sends the file to the standalone AI-first service.
3. Odoo polls or requests `/api/documents/<document_id>`.
4. Odoo reads the `odooPreview` payload and maps:
   - header to the persistent document model
   - lines to One2many rows
   - original file / exported JSON to `ir.attachment`
5. Odoo stores warnings, confidence, and source ids for later audit.

## TypeScript client usage

```ts
import { OdooAiFirstClient } from "./src/client";

const client = new OdooAiFirstClient({
  baseUrl: "http://localhost:3000",
});

const preview = await client.getImportPreview("demo-ai-first-document");
```

## Example Python shape for an Odoo wizard

```python
import requests

def fetch_ai_first_preview(base_url: str, document_id: str) -> dict:
    response = requests.get(f"{base_url}/api/documents/{document_id}", timeout=30)
    response.raise_for_status()
    payload = response.json()
    return payload["odooPreview"]
```

## Suggested Odoo 19 mapping

- Wizard model: `procurement.analysis.import.wizard` as `TransientModel`
- Header model: persistent model for the processed document master row
- Line model: One2many child rows keyed by `external_item_uid`
- Attachment strategy:
  - original uploaded source file
  - exported normalized JSON
  - optional CSV/XLSX review artifact
- Audit fields:
  - `processing_status`
  - `final_confidence_score`
  - `global_warnings`
  - `provider_summary`
