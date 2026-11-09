import fs from "node:fs/promises";
import path from "node:path";
import type { AgentItem, AgentRun, CaseMemory, HumanReview, LearningContext, StageId } from "./types";
import { dataDirectory } from "./store";
import { id, now } from "./utils";

const STOP_WORDS = new Set([
  "para", "con", "sin", "del", "las", "los", "una", "uno", "por", "que", "como",
  "este", "esta", "ese", "esa", "item", "producto", "precio", "fuente", "debe", "desde",
  "sobre", "entre", "solo", "cada", "otro", "otra", "mismo", "misma", "tiene", "tienen"
]);

let memoryWrite = Promise.resolve();

function memoryPath() {
  return path.join(dataDirectory(), "learning", "case-memories.json");
}

export async function listCaseMemories() {
  try {
    return JSON.parse(await fs.readFile(memoryPath(), "utf8")) as CaseMemory[];
  } catch {
    return [];
  }
}

export async function registerCaseMemory(run: AgentRun, item: AgentItem, review: HumanReview): Promise<CaseMemory | null> {
  const guidance = review.comment.trim();
  if (!review.rememberForSimilar || !guidance) return null;
  const at = now();
  const cues = itemCues(item);

  return withMemoryWrite(async () => {
    const memories = await listCaseMemories();
    const guidanceTokens = tokens(guidance);
    const existing = memories
      .filter((entry) => entry.stage === review.stage)
      .map((entry) => ({
        entry,
        guidanceScore: similarity(guidanceTokens, tokens(entry.guidance)),
        itemScore: similarity(new Set(cues), new Set(entry.cues)),
        tagScore: similarity(new Set(review.tags), new Set(entry.tags))
      }))
      .filter(({ guidanceScore, itemScore, tagScore }) =>
        (guidanceScore >= 0.62 && itemScore >= 0.12) ||
        (guidanceScore >= 0.45 && itemScore >= 0.25 && tagScore > 0)
      )
      .sort((left, right) => (right.guidanceScore + right.itemScore + right.tagScore) - (left.guidanceScore + left.itemScore + left.tagScore))[0]?.entry;

    let stored: CaseMemory;
    if (existing) {
      const source = { runId: run.id, itemId: item.id, reviewId: review.id };
      if (!existing.sourceRefs.some((entry) => entry.reviewId === review.id)) {
        existing.sourceRefs.push(source);
        existing.confirmations += 1;
      }
      existing.tags = unique([...existing.tags, ...review.tags]);
      existing.cues = unique([...existing.cues, ...cues]).slice(0, 80);
      existing.strength = existing.confirmations >= 3 ? "recurring" : "candidate";
      existing.updatedAt = at;
      stored = existing;
    } else {
      stored = {
        id: id("memory"),
        title: review.tags[0] || shortTitle(guidance),
        guidance,
        stage: review.stage,
        tags: unique(review.tags),
        cues,
        strength: "candidate",
        confirmations: 1,
        uses: 0,
        sourceRefs: [{ runId: run.id, itemId: item.id, reviewId: review.id }],
        createdAt: at,
        updatedAt: at
      };
      memories.push(stored);
    }
    await writeMemories(memories);
    return stored;
  });
}

export async function findCaseMemories(item: AgentItem, stage: StageId, limit = 4): Promise<LearningContext[]> {
  const memories = await listCaseMemories();
  const cues = new Set(itemCues(item));
  const selected = memories
    .filter((entry) => entry.stage === stage)
    .map((entry) => {
      const lexical = similarity(cues, new Set(entry.cues));
      const strengthBoost = entry.strength === "recurring" ? 0.12 : 0;
      const confirmationBoost = Math.min(0.08, Math.max(0, entry.confirmations - 1) * 0.02);
      return { entry, lexical, score: Math.min(1, lexical + strengthBoost + confirmationBoost) };
    })
    // La recurrencia ordena coincidencias reales, pero nunca puede crear una
    // coincidencia cuando el producto no comparte ninguna señal con el caso.
    .filter(({ lexical, score }) => lexical >= 0.1 && score >= 0.16)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  if (selected.length) {
    await withMemoryWrite(async () => {
      const current = await listCaseMemories();
      for (const match of selected) {
        const found = current.find((entry) => entry.id === match.entry.id);
        if (found) {
          found.uses += 1;
          found.updatedAt = now();
        }
      }
      await writeMemories(current);
    });
  }

  return selected.map(({ entry, score }) => ({
    memoryId: entry.id,
    title: entry.title,
    guidance: entry.guidance,
    stage: entry.stage,
    score: Math.round(score * 100) / 100,
    strength: entry.strength,
    presentedAt: now()
  }));
}

export async function suggestCaseMemories(item: AgentItem, stage?: StageId) {
  const stages = stage ? [stage] : ["extraction", "technical", "market", "supervision"] as StageId[];
  const suggestions = (await Promise.all(stages.map((entry) => findCaseMemories(item, entry, 3)))).flat();
  return suggestions
    .sort((left, right) => right.score - left.score)
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.memoryId === entry.memoryId) === index)
    .slice(0, 6);
}

export async function commonCaseMemories(limit = 8) {
  return (await listCaseMemories())
    .sort((left, right) =>
      Number(right.strength === "recurring") - Number(left.strength === "recurring") ||
      right.confirmations - left.confirmations ||
      right.uses - left.uses
    )
    .slice(0, limit);
}

export function itemCues(item: AgentItem) {
  return [...tokens([
    item.original.name,
    item.original.description,
    item.original.unit,
    item.normalized?.name,
    item.normalized?.description,
    item.technical?.searchBrief,
    ...(item.technical?.hardRequirements || [])
  ].filter(Boolean).join(" "))].slice(0, 60);
}

function tokens(value: string) {
  return new Set(
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((entry) => entry.length >= 3 && !STOP_WORDS.has(entry))
  );
}

function similarity(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const entry of left) if (right.has(entry)) overlap += 1;
  return overlap / Math.max(1, left.size + right.size - overlap);
}

function shortTitle(value: string) {
  const words = value.replace(/\s+/g, " ").trim().split(" ");
  return words.slice(0, 7).join(" ");
}

function unique(values: string[]) {
  return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))];
}

async function writeMemories(memories: CaseMemory[]) {
  const target = memoryPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(memories, null, 2), "utf8");
  await fs.rename(temp, target).catch(async () => {
    await fs.rm(target, { force: true });
    await fs.rename(temp, target);
  });
}

async function withMemoryWrite<T>(operation: () => Promise<T>) {
  let result!: T;
  const previous = memoryWrite;
  memoryWrite = previous.catch(() => undefined).then(async () => {
    result = await operation();
  });
  await memoryWrite;
  return result;
}
