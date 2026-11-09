"use client";

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

export type PopoverPosition = { top: number; left: number; width: number };

export function anchoredPopoverPosition(
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  panelWidth: number,
  panelHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  minTop = 8,
  align: "start" | "end" = "end",
): PopoverPosition {
  const width = Math.min(panelWidth, Math.max(160, viewportWidth - 16));
  const left = Math.max(8, Math.min(align === "start" ? anchor.left : anchor.right - width, viewportWidth - width - 8));
  const below = anchor.bottom + 6;
  const safeTop = Math.min(Math.max(8, minTop), Math.max(8, viewportHeight - panelHeight - 8));
  const above = anchor.top - panelHeight - 6;
  const top = below + panelHeight <= viewportHeight - 8
    ? below
    : above >= safeTop ? above : safeTop;
  return { top, left, width };
}

export function actionSheetPosition(panelHeight: number, viewportWidth: number, viewportHeight: number, offsetTop = 0): PopoverPosition {
  const height = Math.min(panelHeight, Math.max(0, viewportHeight - 16));
  return { top: offsetTop + Math.max(8, viewportHeight - height - 8), left: 8, width: Math.max(0, viewportWidth - 16) };
}
export function AnchoredPopover(props: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  id: string;
  className: string;
  width: number;
  minTop?: number;
  align?: "start" | "end";
  ariaLabel?: string;
  showClose?: boolean;
  keepMounted?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => { setMounted(true); }, []);
  const [mobile, setMobile] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  useLayoutEffect(() => {
    if (!mounted || !props.open) return;
    const reposition = () => {
      const anchor = props.anchorRef.current;
      if (!anchor) return;
      const width = Math.min(props.width, Math.max(160, window.innerWidth - 16));
      const height = panelRef.current?.offsetHeight ?? 0;
      const visual = window.visualViewport;
      const viewportHeight = visual?.height ?? window.innerHeight;
      const isMobile = window.innerWidth <= 640;
      setMobile(isMobile);
      setViewportHeight(viewportHeight);
      setPosition(isMobile
        ? actionSheetPosition(height, visual?.width ?? window.innerWidth, viewportHeight, visual?.offsetTop ?? 0)
        : anchoredPopoverPosition(anchor.getBoundingClientRect(), width, height, window.innerWidth, viewportHeight, props.minTop, props.align));
    };
    reposition();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
    if (panelRef.current) observer?.observe(panelRef.current);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      observer?.disconnect();
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [mounted, props.open, props.width, props.anchorRef, props.minTop, props.align]);

  useLayoutEffect(() => {
    if (!mounted || !props.open) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || props.anchorRef.current?.contains(target)) return;
      props.onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Tab" && mobile && panelRef.current) {
        const controls = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')].filter((element) => element.getClientRects().length);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!panelRef.current.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onClose();
      props.anchorRef.current?.focus();
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [mounted, props.open, props.anchorRef, props.onClose, mobile]);

  useLayoutEffect(() => {
    if (!mounted || !props.open || !mobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [mounted, props.open, mobile]);
  const close = () => { props.onClose(); props.anchorRef.current?.focus({ preventScroll: true }); };
  if (!mounted || (!props.open && !props.keepMounted)) return null;
  return createPortal(
    <>
    {props.open && mobile ? <div className="caf-action-backdrop" aria-hidden="true" onMouseDown={close} /> : null}
    <div ref={panelRef} hidden={!props.open} id={props.id} className={`${props.className} caf-action-panel`} data-sheet={mobile || undefined} aria-modal={(props.open && mobile) || undefined} role={props.ariaLabel ? "dialog" : undefined} aria-label={props.ariaLabel} data-preserve-manual-draft="true"
      style={{ display: props.open ? undefined : "none", position: "fixed", top: position?.top ?? 0, left: position?.left ?? 0,
        maxHeight: viewportHeight ? Math.max(0, viewportHeight - 16) : undefined,
        width: position?.width ?? props.width, visibility: position ? "visible" : "hidden" }}>
      {mobile && props.showClose !== false ? <div className="caf-action-panel-heading"><strong>{props.ariaLabel}</strong><button type="button" onClick={close}>Cerrar</button></div> : null}
      {props.children}
    </div>
    </>,
    document.body,
  );
}
