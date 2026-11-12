"use client";
import { useEffect, useRef } from "react";

export function LotSelection(props: { label: string; keys: string[]; selected: Set<string>; onChange: (checked: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const count = props.keys.filter(key => props.selected.has(key)).length;
  useEffect(() => { if (ref.current) ref.current.indeterminate = count > 0 && count < props.keys.length; }, [count, props.keys.length]);
  return <input ref={ref} type="checkbox" checked={props.keys.length > 0 && count === props.keys.length} onChange={event => props.onChange(event.target.checked)} aria-label={`Seleccionar ${props.label} para acciones`} />;
}
