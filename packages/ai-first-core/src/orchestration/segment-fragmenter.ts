import type { SourceSegment } from "../../../ai-first-contracts/src/schemas/source";

import { looksLikeStructuredItemStart } from "../document/item-label-utils";

function collectLines(rawText: string): Array<{ line: string; lineIndex: number }> {
  return rawText
    .split(/\r?\n/)
    .map((line, lineIndex) => ({ line: line.trim(), lineIndex }))
    .filter((entry) => entry.line.length > 0);
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isHeaderLine(line: string): boolean {
  const lowered = line.toLowerCase();
  const headerScore = ["item", "descripcion", "cantidad", "unidad", "precio", "valor", "moneda"].filter((token) =>
    lowered.includes(token),
  ).length;

  return headerScore >= 3 && !/^\d+(?:\.\d+)?/.test(line);
}

function isNoteLine(line: string): boolean {
  return /^(nota|notas|observacion(?:es)?|fuente|total|subtotal)\b/i.test(line);
}

function looksLikeCandidateStart(line: string): boolean {
  return !isHeaderLine(line) && !isNoteLine(line) && looksLikeStructuredItemStart(line);
}

export interface FragmentationResult {
  candidateSegments: SourceSegment[];
  discardedLines: Array<{
    parent_segment_id: string;
    line_index: number;
    line: string;
    reason: "header" | "note" | "unclassified";
  }>;
}

export class PhysicalSegmentFragmenter {
  fragment(segments: SourceSegment[]): FragmentationResult {
    const candidateSegments: SourceSegment[] = [];
    const discardedLines: FragmentationResult["discardedLines"] = [];

    let globalFragmentIndex = 0;

    for (const parentSegment of segments) {
      const lines = collectLines(parentSegment.raw_text);
      let buffer: Array<{ line: string; lineIndex: number }> = [];
      let localFragmentIndex = 0;

      const flushBuffer = () => {
        if (buffer.length === 0) {
          return;
        }

        const first = buffer[0];
        const last = buffer[buffer.length - 1];
        const rawText = buffer.map((entry) => entry.line).join("\n");
        const baseRowStart = parentSegment.locator.row_start;
        const fragmentId = `${parentSegment.segment_id}::fragment-${localFragmentIndex + 1}`;

        candidateSegments.push({
          ...parentSegment,
          segment_id: fragmentId,
          segment_index: globalFragmentIndex,
          raw_text: rawText,
          normalized_text: parentSegment.normalized_text,
          locator: {
            ...parentSegment.locator,
            row_start: baseRowStart !== null ? baseRowStart + first.lineIndex : parentSegment.locator.row_start,
            row_end: baseRowStart !== null ? baseRowStart + last.lineIndex : parentSegment.locator.row_end,
            note: collapseWhitespace(
              [parentSegment.locator.note, `fragment lines ${first.lineIndex}-${last.lineIndex}`]
                .filter(Boolean)
                .join(" | "),
            ),
          },
          checksum_sha256: `${fragmentId}-checksum`,
          metadata: {
            ...parentSegment.metadata,
            parent_segment_id: parentSegment.segment_id,
            fragment_line_start: first.lineIndex,
            fragment_line_end: last.lineIndex,
          },
        });

        buffer = [];
        globalFragmentIndex += 1;
        localFragmentIndex += 1;
      };

      for (const entry of lines) {
        if (isHeaderLine(entry.line)) {
          flushBuffer();
          discardedLines.push({
            parent_segment_id: parentSegment.segment_id,
            line_index: entry.lineIndex,
            line: entry.line,
            reason: "header",
          });
          continue;
        }

        if (looksLikeCandidateStart(entry.line)) {
          flushBuffer();
          buffer.push(entry);
          continue;
        }

        if (isNoteLine(entry.line)) {
          flushBuffer();
          discardedLines.push({
            parent_segment_id: parentSegment.segment_id,
            line_index: entry.lineIndex,
            line: entry.line,
            reason: "note",
          });
          continue;
        }

        if (buffer.length > 0) {
          buffer.push(entry);
        } else {
          discardedLines.push({
            parent_segment_id: parentSegment.segment_id,
            line_index: entry.lineIndex,
            line: entry.line,
            reason: "unclassified",
          });
        }
      }

      flushBuffer();
    }

    return {
      candidateSegments,
      discardedLines,
    };
  }
}
