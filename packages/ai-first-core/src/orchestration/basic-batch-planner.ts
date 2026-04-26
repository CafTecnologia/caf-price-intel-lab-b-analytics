import type { Batch } from "../../../ai-first-contracts/src/schemas/batch";
import type { ProviderConfigByTask } from "../../../ai-first-contracts/src/schemas/provider-config";
import type { DetectionSummary, SourceSegment } from "../../../ai-first-contracts/src/schemas/source";

const GEMINI_EFFECTIVE_BATCH_CAP = 4;
const GEMINI_BATCH_CHAR_BUDGET = 1300;
const GEMINI_LONG_SEGMENT_THRESHOLD = 550;

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

function resolveEffectiveBatchSize(providerConfig: ProviderConfigByTask, requestedBatchSize: number): number {
  const boundedRequestedSize = Math.min(Math.max(requestedBatchSize, 1), 20);

  if (providerConfig.extractItemsBatch.provider === "gemini") {
    return Math.min(boundedRequestedSize, GEMINI_EFFECTIVE_BATCH_CAP);
  }

  return boundedRequestedSize;
}

function buildGeminiSegmentGroups(segments: SourceSegment[], requestedBatchSize: number): SourceSegment[][] {
  const maxSegments = Math.min(Math.max(requestedBatchSize, 1), GEMINI_EFFECTIVE_BATCH_CAP);
  const groups: SourceSegment[][] = [];
  let currentGroup: SourceSegment[] = [];
  let currentChars = 0;

  const flushCurrentGroup = () => {
    if (currentGroup.length === 0) {
      return;
    }

    groups.push(currentGroup);
    currentGroup = [];
    currentChars = 0;
  };

  for (const segment of segments) {
    const segmentChars = segment.raw_text.length;

    if (segmentChars >= GEMINI_LONG_SEGMENT_THRESHOLD) {
      flushCurrentGroup();
      groups.push([segment]);
      continue;
    }

    const wouldExceedGroupSize = currentGroup.length >= maxSegments;
    const wouldExceedCharBudget = currentGroup.length > 0 && currentChars + segmentChars > GEMINI_BATCH_CHAR_BUDGET;

    if (wouldExceedGroupSize || wouldExceedCharBudget) {
      flushCurrentGroup();
    }

    currentGroup.push(segment);
    currentChars += segmentChars;
  }

  flushCurrentGroup();
  return groups;
}

export class BasicBatchPlanner {
  selectSegments(segments: SourceSegment[], detectionSummary: DetectionSummary): SourceSegment[] {
    const ranges = detectionSummary.selected_blocks;
    if (ranges.length === 0) {
      return segments;
    }

    const selected = new Map<string, SourceSegment>();
    for (const range of ranges) {
      for (const segment of segments) {
        if (
          segment.segment_index >= range.source_range.start_segment_index &&
          segment.segment_index <= range.source_range.end_segment_index
        ) {
          selected.set(segment.segment_id, segment);
        }
      }
    }

    return Array.from(selected.values()).sort((left, right) => left.segment_index - right.segment_index);
  }

  buildBatches(args: {
    documentId: string;
    segments: SourceSegment[];
    providerConfig: ProviderConfigByTask;
    batchSize: number;
  }): Array<{ batch: Batch; segments: SourceSegment[] }> {
    const segmentGroups =
      args.providerConfig.extractItemsBatch.provider === "gemini"
        ? buildGeminiSegmentGroups(args.segments, args.batchSize)
        : chunk(args.segments, resolveEffectiveBatchSize(args.providerConfig, args.batchSize));

    return segmentGroups.map((segmentGroup, batchIndex) => {
      const first = segmentGroup[0];
      const last = segmentGroup[segmentGroup.length - 1];

      return {
        batch: {
          batch_id: `${args.documentId}:batch-${batchIndex + 1}`,
          document_id: args.documentId,
          batch_index: batchIndex,
          source_range: {
            start_segment_id: first.segment_id,
            end_segment_id: last.segment_id,
            start_segment_index: first.segment_index,
            end_segment_index: last.segment_index,
            label: `segments ${first.segment_index}-${last.segment_index}`,
          },
          provider: args.providerConfig.extractItemsBatch.provider,
          model: args.providerConfig.extractItemsBatch.model,
          prompt_version: args.providerConfig.extractItemsBatch.prompt_version,
          extraction_status: "pending",
          validation_status: "pending",
          output_json: [],
          validation_json: null,
          confidence_score: null,
          warnings: [],
          retry_count: 0,
          candidate_item_count: null,
          extracted_item_count: null,
          validated_item_count: null,
          started_at: null,
          finished_at: null,
        },
        segments: segmentGroup,
      };
    });
  }
}
