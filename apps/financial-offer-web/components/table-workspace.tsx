"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

type HorizontalDrag = {
  pointerId: number;
  startX: number;
  startScrollLeft: number;
  moved: boolean;
};

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button, a, input, select, textarea, label, summary, [contenteditable='true'], [role='button']"));
}

export function TableWorkspace(props: { children: ReactNode; compactNote?: string }) {
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef<"top" | "bottom" | null>(null);
  const horizontalDragRef = useRef<HorizontalDrag | null>(null);
  const suppressClickRef = useRef(false);
  const [contentWidth, setContentWidth] = useState(0);

  useEffect(() => {
    const measure = measureRef.current;
    if (!measure) return;

    const updateWidth = () => setContentWidth(measure.scrollWidth);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [props.children]);

  function syncFromTop() {
    if (syncingRef.current === "bottom") {
      syncingRef.current = null;
      return;
    }
    if (topScrollRef.current && bottomScrollRef.current) {
      syncingRef.current = "top";
      bottomScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  }

  function syncFromBottom() {
    if (syncingRef.current === "top") {
      syncingRef.current = null;
      return;
    }
    if (topScrollRef.current && bottomScrollRef.current) {
      syncingRef.current = "bottom";
      topScrollRef.current.scrollLeft = bottomScrollRef.current.scrollLeft;
    }
  }

  function beginHorizontalDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const scroll = bottomScrollRef.current;
    if (event.button !== 0 || isInteractiveTarget(event.target) || !scroll || scroll.scrollWidth <= scroll.clientWidth) return;
    horizontalDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: scroll.scrollLeft,
      moved: false,
    };
    suppressClickRef.current = false;
    scroll.setPointerCapture(event.pointerId);
  }

  function moveHorizontalDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const scroll = bottomScrollRef.current;
    const drag = horizontalDragRef.current;
    if (!scroll || !drag || drag.pointerId !== event.pointerId) return;
    const distance = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(distance) < 4) return;
    drag.moved = true;
    suppressClickRef.current = true;
    scroll.classList.add("is-dragging");
    scroll.scrollLeft = drag.startScrollLeft - distance;
    event.preventDefault();
  }

  function endHorizontalDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const scroll = bottomScrollRef.current;
    const drag = horizontalDragRef.current;
    if (!scroll || !drag || drag.pointerId !== event.pointerId) return;
    if (scroll.hasPointerCapture(event.pointerId)) scroll.releasePointerCapture(event.pointerId);
    scroll.classList.remove("is-dragging");
    horizontalDragRef.current = null;
  }

  return (
    <div className="table-workspace-shell">
      {props.compactNote ? (
        <div className="table-workspace-toolbar">
          <span className="info-dot" title={props.compactNote}>i</span>
        </div>
      ) : null}
      <div ref={topScrollRef} className="table-scroll-sync table-scroll-sync-top" onScroll={syncFromTop}>
        <div style={{ width: `${contentWidth}px` }} />
      </div>
      <div
        ref={bottomScrollRef}
        className="table-wrap table-scroll-bottom drag-scroll-surface"
        aria-label="Tabla financiera desplazable horizontalmente"
        onScroll={syncFromBottom}
        onPointerDown={beginHorizontalDrag}
        onPointerMove={moveHorizontalDrag}
        onPointerUp={endHorizontalDrag}
        onPointerCancel={endHorizontalDrag}
        onClickCapture={(event) => {
          if (!suppressClickRef.current) return;
          suppressClickRef.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <div ref={measureRef}>{props.children}</div>
      </div>
    </div>
  );
}
