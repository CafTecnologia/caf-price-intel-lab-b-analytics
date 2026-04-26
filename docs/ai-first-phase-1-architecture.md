# AI-First Document Ingestion Architecture - Phase 1

## 1. Executive summary

This phase defines a new architecture track inside the monorepo for an AI-first ingestion product that is intentionally different from the current `local-first / LLM-last` stack.

The target product will:

- ingest PDF, Excel, and Word files
- detect the relevant official block with AI
- extract items in small batches with AI as the main interpreter
- validate each batch with a second AI pass
- run a global AI validation for the whole document
- persist every prompt, response, score, warning, and provider decision
- expose a standalone web app and a service boundary ready for Odoo 19

The deterministic layer is intentionally narrow:

- file intake and storage
- physical segmentation into source spans
- batch planning
- schema validation
- retries and timeouts
- persistence and audit logs
- export and UI rendering
- Odoo mapping preparation

Business interpretation stays in the AI orchestration layer, not in regex-heavy parsers or layout-specific hardcoded rules.

## 2. Architecture decision

### Chosen shape

The product will be implemented as a polyglot monorepo with a new TypeScript-first vertical:

- `apps/ai-first-web`: Next.js UI for upload, progress, review, exports, and Odoo preview
- `apps/ai-first-api`: TypeScript API for upload, orchestration commands, reads, exports, and Odoo-facing endpoints
- `apps/ai-first-worker`: async worker that executes detection, extraction, validation, retries, and consolidation
- `packages/ai-first-contracts`: shared Zod schemas, DTOs, enums, and provider contracts
- `packages/ai-first-prompts`: versioned internal prompts
- `integrations/odoo`: Odoo-facing DTOs, mappers, example payloads, and implementation notes
- `prisma`: Postgres persistence model for documents, batches, items, logs, and provider snapshots

### Why a separate API + worker instead of Next.js-only route handlers

The UI can stay modern with Next.js, but the backend should be independently callable from Odoo and from future automation flows. A decoupled API and worker give us:

- a stable service boundary for Odoo
- no tight coupling between UI deploys and background processing
- easier selective reprocessing per batch
- cleaner provider switching per task or per batch
- simpler horizontal scaling for batch jobs

## 3. Layered architecture

### 3.1 UI Layer

Responsibilities:

- upload files
- choose provider/model per task
- configure batch size, default `10`, max `20`
- render processing timeline and per-batch status
- render final review table
- render batch review panel
- render Odoo integration preview
- export JSON and optional CSV/XLSX

### 3.2 API / Application Layer

Responsibilities:

- accept uploads
- create processing jobs
- expose read models for progress and results
- expose reprocess-batch endpoints
- expose export endpoints
- expose Odoo preview payloads
- enforce schema validation and API authorization

### 3.3 AI Orchestration Layer

Responsibilities:

- resolve prompt version per task
- resolve provider/model per task
- execute AI tasks with timeout/retry/token policy
- store prompt/response snapshots
- parse and validate structured outputs
- route reprocessing with provider overrides

Core AI tasks:

- `detectOfficialBlock`
- `extractItemsBatch`
- `validateBatch`
- `validateGlobal`

### 3.4 Document Understanding Core

Responsibilities:

- file-type detection
- physical segmentation into source spans
- lightweight extraction of raw text, sheet ranges, paragraph spans, and page blocks
- batch planning from source spans
- no semantic normalization beyond preserving structure and evidence

### 3.5 Validation Core

Responsibilities:

- schema validation
- batch-level validation pass with AI
- document-level validation pass with AI
- score computation aggregation
- consolidation from accepted or accepted-with-warning batches

### 3.6 Persistence Layer

Responsibilities:

- Postgres persistence
- prompt version storage
- provider configuration snapshots
- batch execution state
- extracted items
- validation outputs
- audit logs
- exports and reprocessing history

### 3.7 Integration Prep Layer for Odoo 19

Responsibilities:

- DTOs that map to header + lines
- attachment and audit mapping strategy
- wizard-oriented request/response shapes
- payload previews for future Odoo module consumption

## 4. Proposed folder structure

```text
procurement-analytics/
|- apps/
|  |- ai-first-web/                 Next.js app router UI
|  |- ai-first-api/                 HTTP API and orchestration endpoints
|  `- ai-first-worker/              Async batch worker
|- packages/
|  |- ai-first-contracts/
|  |  `- src/
|  |     |- enums.ts
|  |     |- providers/
|  |     |  `- ai-provider.ts
|  |     |- pipeline/
|  |     |  `- orchestration.ts
|  |     `- schemas/
|  |        |- provider-config.ts
|  |        |- source.ts
|  |        |- item.ts
|  |        |- validation.ts
|  |        |- batch.ts
|  |        `- document.ts
|  `- ai-first-prompts/
|     `- src/
|        |- base.ts
|        |- detect-official-block.ts
|        |- extract-items-batch.ts
|        |- validate-batch.ts
|        |- validate-global.ts
|        `- index.ts
|- prisma/
|  `- schema.prisma
|- integrations/
|  `- odoo/
|     |- README.md
|     `- src/
|        |- dtos.ts
|        `- mappers.ts
|- docs/
|  `- ai-first-phase-1-architecture.md
`- addons/
   `- odoo_procurement_analysis/    Existing addon line; future Odoo 19 adapter will consume the new service layer
```

## 5. Key dependencies

### Frontend

- `next`
- `react`
- `typescript`
- `tailwindcss`
- `@tanstack/react-table`
- `@tanstack/react-query`
- `zod`
- `react-hook-form`

### API / Worker

- `fastify`
- `zod`
- `prisma`
- `@prisma/client`
- `pg-boss` for job orchestration on Postgres
- `pino` for structured logs
- `undici` or provider SDK wrappers only inside adapters

### Document understanding

- `pdfjs-dist` for PDF text spans and positional extraction
- `xlsx` or `exceljs` for spreadsheet reads
- `mammoth` for DOCX extraction
- optional OCR-ready abstraction for future engines

### Export

- `json2csv`
- `exceljs`

### Testing

- `vitest`
- `@vitest/coverage-v8`
- `playwright`

## 6. Main entities

### UploadedFile

- immutable uploaded asset
- checksum, mime, file type, storage key, byte size

### Document

- processing root entity
- links one uploaded file to one AI-first ingestion run
- stores detection summary, provider config snapshot, global validation, final result

### SourceSegment

- smallest physical evidence unit
- page block, sheet range, table slice, paragraph span, or row range
- generated before any semantic AI interpretation

### Batch

- processing envelope for a subset of segments and up to `20` intended items
- has extraction state, validation state, warnings, prompt version, provider/model used

### NormalizedItem

- auditable item record ready for review and future Odoo mapping
- preserves source location and raw text evidence

### BatchValidation

- second-pass AI review per batch
- stores completeness, hallucination, structural consistency, warnings, recommendation

### DocumentValidation

- global AI review across accepted batches
- checks cross-batch completeness, continuity, duplicates, and trustworthiness

### PromptTemplate / PromptExecution

- versioned internal prompts
- exact prompt and provider/model used at runtime

### AuditLog

- structured event trail for debugging, retries, provider failures, and manual review triggers

## 7. Zod schema strategy

The strict contracts for this phase live in `packages/ai-first-contracts`.

Important choices:

- all top-level schemas are `.strict()`
- nullable business fields use `null` instead of weak inference
- extraction mode explicitly distinguishes direct extraction vs conservative reconstruction
- provider config is stored per AI task, not only per document
- batch result and validation result stay separately persisted

Top-level result shape:

- `document_id`
- `file_name`
- `file_type`
- `processing_status`
- `detection_summary`
- `provider_config_used`
- `total_candidate_items`
- `total_extracted_items`
- `total_validated_items`
- `final_confidence_score`
- `global_warnings`
- `batches`
- `items`

Per-item minimum shape:

- `item_uid`
- `numero_item`
- `nombre_o_descripcion`
- `ficha_tecnica`
- `cantidad`
- `unidad_medida`
- `precio_referencia_unit`
- `precio_referencia_total`
- `moneda`
- `raw_text_evidence`
- `source_location`
- `extraction_mode`
- `warnings`
- `confidence`

## 8. Provider interface design

The provider layer is intentionally adapter-based and task-oriented.

Every provider adapter must implement:

- `detectOfficialBlock`
- `extractItemsBatch`
- `validateBatch`
- `validateGlobal`

Every task receives:

- document or batch identity
- source segments or consolidated items
- versioned prompt artifact
- provider runtime config
- response schema name

Every task returns:

- structured output validated with Zod
- provider usage metadata
- raw response snapshot for audit

Providers remain replaceable because the orchestration layer only depends on the shared interface, not on vendor-specific SDK semantics.

## 9. AI-first batch pipeline

### Step 1. Intake

- store original file
- compute checksum
- register document

### Step 2. Physical segmentation

- split PDF into page blocks / table spans
- split Excel into sheet ranges
- split Word into paragraph/table spans
- store segments as immutable source evidence

### Step 3. Official block detection

- send segment batches to `detectOfficialBlock`
- identify the official block or blocks relevant for extraction
- persist detection rationale and confidence

### Step 4. Batch planning

- plan batches from selected source ranges
- default size `10`
- hard max `20`
- each batch stores range, provider, model, and prompt version

### Step 5. Batch extraction

- run `extractItemsBatch`
- AI reconstructs fragmented rows and distinguishes headers from items
- deterministic layer only checks schema validity and cardinality constraints

### Step 6. Batch self-validation

- run `validateBatch` on the extracted batch output plus evidence
- capture recommendation:
  - `accept`
  - `accept_with_warning`
  - `retry`
  - `manual_review`

### Step 7. Global validation

- consolidate only valid or warning-accepted batches
- run `validateGlobal`
- verify cross-batch continuity, duplicates, missed blocks, and total plausibility

### Step 8. Final review package

- persist consolidated JSON
- build UI read models
- build export artifacts
- build Odoo preview payload

## 10. Persistence and audit model

The initial Postgres model in `prisma/schema.prisma` stores:

- uploaded file metadata
- document metadata
- source segments
- per-task provider snapshots
- prompt templates and prompt executions
- batch outputs
- batch validations
- global validation
- normalized items
- audit logs

This gives selective reprocessing at the batch level without losing the original evidence chain.

## 11. Odoo 19 preparation

The Odoo-facing layer is intentionally thin. The AI-first core stays outside Odoo and exposes DTOs that Odoo can consume through a wizard, button, or service call.

Prepared integration surfaces:

- header DTO for the future Odoo master record
- line DTOs for future One2many child rows
- attachment references for `ir.attachment`
- audit summary for review logs
- mapping preview for the UI and later wizard confirmation

Verified Odoo 19 alignment from official docs:

- wizards are launched through `ir.actions.act_window` with `target="new"` and can be bound to a model using `binding_model_id`
- transient wizard state should live in `TransientModel`
- client-side preview flows can use `ir.actions.client`
- server-side logging can be mirrored into `ir.logging`

Sources:

- [Odoo 19 backend tutorial - launching wizards](https://www.odoo.com/documentation/19.0/it/developer/tutorials/backend.html)
- [Odoo 19 ORM reference - TransientModel](https://www.odoo.com/documentation/19.0/developer/reference/backend/orm.html)
- [Odoo 19 backend actions reference](https://www.odoo.com/documentation/19.0/th/developer/reference/backend/actions.html)

## 12. Recommended Phase 2

After this phase, the next implementation phase should build only:

1. `packages/ai-first-contracts`
2. `packages/ai-first-prompts`
3. `prisma/schema.prisma` migrations
4. `apps/ai-first-api` upload + document read endpoints
5. `apps/ai-first-worker` detection/extraction/validation pipeline
6. minimal `apps/ai-first-web` upload + processing + results views

That keeps execution aligned with the AI-first architecture instead of drifting back to parser-first logic.
