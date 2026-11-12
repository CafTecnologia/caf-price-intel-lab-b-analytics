"use client";

import { useEffect, useRef, useState } from "react";

import {
  cleanDecimalRateDraft,
  commitDecimalRateDraft,
  formatDecimalRateDraft,
  parseDecimalRateDraft,
} from "@offer/lib/decimal-rate";

export function DecimalRateInput(props: {
  value: number;
  onValueChange: (value: number) => void;
  ariaLabel: string;
  className?: string;
}) {
  const focused = useRef(false);
  const [draft, setDraft] = useState(() => formatDecimalRateDraft(props.value));

  useEffect(() => {
    if (!focused.current) setDraft(formatDecimalRateDraft(props.value));
  }, [props.value]);

  return (
    <input
      className={props.className}
      type="text"
      inputMode="decimal"
      value={draft}
      aria-label={props.ariaLabel}
      onFocus={() => { focused.current = true; }}
      onChange={(event) => {
        const nextDraft = cleanDecimalRateDraft(event.target.value);
        setDraft(nextDraft);
        const parsed = parseDecimalRateDraft(nextDraft);
        if (parsed !== null) props.onValueChange(parsed);
      }}
      onBlur={() => {
        focused.current = false;
        const committed = commitDecimalRateDraft(draft);
        setDraft(formatDecimalRateDraft(committed));
        props.onValueChange(committed);
      }}
    />
  );
}
