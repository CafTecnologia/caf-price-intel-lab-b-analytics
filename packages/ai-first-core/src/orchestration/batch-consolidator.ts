import type { Batch } from "../../../ai-first-contracts/src/schemas/batch";
import type { NormalizedItem } from "../../../ai-first-contracts/src/schemas/item";

function normalizeText(value: string | null): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function buildMergeKey(item: NormalizedItem): string {
  if (item.numero_item && item.nombre_o_descripcion) {
    return `${item.numero_item}|${normalizeText(item.nombre_o_descripcion)}`;
  }

  return item.item_uid;
}

function isManualReviewItem(item: NormalizedItem): boolean {
  return item.warnings.some((warning) => warning.includes("manual_review"));
}

export interface ConsolidationTrace {
  duplicate_resolutions: Array<{
    merge_key: string;
    kept_item_uid: string;
    dropped_item_uids: string[];
  }>;
  warnings: string[];
}

export interface ConsolidationResult {
  items: NormalizedItem[];
  warnings: string[];
  trace: ConsolidationTrace;
  accepted_batches: Batch[];
}

export class FinalResultConsolidator {
  consolidate(batches: Batch[]): ConsolidationResult {
    const acceptedBatches = batches.filter(
      (batch) => batch.validation_json?.recommendation === "accept" || batch.validation_json?.recommendation === "accept_with_warning",
    );
    const manualReviewBatches = batches.filter(
      (batch) => batch.validation_json?.recommendation === "manual_review" && batch.output_json.length > 0,
    );
    const batchesForReviewTable = [...acceptedBatches, ...manualReviewBatches];

    const keptByKey = new Map<string, NormalizedItem>();
    const duplicateTrace = new Map<string, { kept_item_uid: string; dropped_item_uids: string[] }>();

    for (const batch of batchesForReviewTable) {
      const isManualReviewBatch = batch.validation_json?.recommendation === "manual_review";

      for (const item of batch.output_json) {
        const effectiveItem = isManualReviewBatch
          ? {
              ...item,
              warnings: Array.from(
                new Set([
                  ...item.warnings,
                  `Included from batch ${batch.batch_id} marked as manual_review; human review is required.`,
                ]),
              ),
            }
          : item;
        const mergeKey = buildMergeKey(effectiveItem);
        const existing = keptByKey.get(mergeKey);

        if (!existing) {
          keptByKey.set(mergeKey, effectiveItem);
          continue;
        }

        const keepCurrent =
          isManualReviewItem(existing) && !isManualReviewItem(effectiveItem)
            ? true
            : isManualReviewItem(existing) === isManualReviewItem(effectiveItem)
              ? effectiveItem.confidence > existing.confidence
              : false;
        const kept = keepCurrent ? effectiveItem : existing;
        const dropped = keepCurrent ? existing : effectiveItem;
        keptByKey.set(mergeKey, kept);

        const existingTrace = duplicateTrace.get(mergeKey) ?? {
          kept_item_uid: kept.item_uid,
          dropped_item_uids: [],
        };
        existingTrace.kept_item_uid = kept.item_uid;
        existingTrace.dropped_item_uids = Array.from(
          new Set([...existingTrace.dropped_item_uids, dropped.item_uid]),
        );
        duplicateTrace.set(mergeKey, existingTrace);
      }
    }

    const duplicateResolutions = Array.from(duplicateTrace.entries()).map(([merge_key, resolution]) => ({
      merge_key,
      kept_item_uid: resolution.kept_item_uid,
      dropped_item_uids: resolution.dropped_item_uids,
    }));

    const warnings =
      duplicateResolutions.length > 0 || manualReviewBatches.length > 0
        ? [
            ...(duplicateResolutions.length > 0
              ? [`Resolved ${duplicateResolutions.length} duplicate item groups during final consolidation.`]
              : []),
            ...(manualReviewBatches.length > 0
              ? [`Included ${manualReviewBatches.length} manual-review batch(es) in the final review table.`]
              : []),
          ]
        : [];

    return {
      items: Array.from(keptByKey.values()),
      warnings,
      trace: {
        duplicate_resolutions: duplicateResolutions,
        warnings,
      },
      accepted_batches: acceptedBatches,
    };
  }
}
