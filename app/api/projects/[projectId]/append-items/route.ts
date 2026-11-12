import { NextResponse } from "next/server";

import { normalizeImportPayload, toProject } from "@offer/lib/contract";
import { getCalculation, saveCalculation } from "@offer/lib/store";

function uniqueItemId(base: string, used: Set<string>): string {
  let candidate = base || "item";
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base || "item"}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function isInitialPlaceholderItem(item: { description?: string; notes?: string }): boolean {
  return item.description === "Item pendiente" && item.notes === "Cálculo creado para carga manual posterior.";
}

export async function POST(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  const current = await getCalculation(projectId);
  if (!current) {
    return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
  }

  try {
    const body = await request.json();
    const parsed = normalizeImportPayload(body);
    const imported = toProject(parsed, `${projectId}-append`, new Date().toISOString());
    const baseItems = current.items.length === 1 && isInitialPlaceholderItem(current.items[0]) ? [] : current.items;
    const usedIds = new Set(baseItems.map((item) => item.id));
    const usedItemLabels = new Set(baseItems.map((item) => item.item).filter(Boolean));
    const firstIndex = baseItems.length + 1;
    const appended = imported.items.map((item, index) => {
      const fallbackLabel = String(firstIndex + index);
      const itemLabel = item.item && !usedItemLabels.has(item.item) ? item.item : fallbackLabel;
      usedItemLabels.add(itemLabel);
      return {
        ...item,
        id: uniqueItemId(`append-${Date.now()}-${index + 1}-${item.id}`, usedIds),
        item: itemLabel,
      };
    });

    if (!appended.length) {
      return NextResponse.json({ error: "No se encontraron items para agregar." }, { status: 400 });
    }

    const calculation = await saveCalculation(projectId, { items: [...baseItems, ...appended] });
    if (!calculation) {
      return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
    }

    return NextResponse.json({ calculation, project: calculation, appendedCount: appended.length });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "No se pudieron agregar los items.",
        code: "APPEND_ITEMS_FAILED",
      },
      { status: 400 },
    );
  }
}
