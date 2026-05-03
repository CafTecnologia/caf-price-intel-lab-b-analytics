"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function TableWorkspace(props: { children: ReactNode; compactNote?: string }) {
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef<"top" | "bottom" | null>(null);
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

  return (
    <div className="table-workspace-shell">
      <div className="table-workspace-toolbar">
        <span className="info-dot" title={props.compactNote ?? "Tabla de trabajo compacta"}>
          i
        </span>
      </div>
      <div ref={topScrollRef} className="table-scroll-sync table-scroll-sync-top" onScroll={syncFromTop}>
        <div style={{ width: `${contentWidth}px` }} />
      </div>
      <div ref={bottomScrollRef} className="table-wrap table-scroll-bottom" onScroll={syncFromBottom}>
        <div ref={measureRef}>{props.children}</div>
      </div>
    </div>
  );
}
