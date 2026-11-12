import { describe, expect, it } from "vitest";

import {
  cleanDecimalRateDraft,
  commitDecimalRateDraft,
  formatDecimalRateDraft,
  parseDecimalRateDraft,
} from "../lib/decimal-rate";

describe("decimal retention rates", () => {
  it("keeps comma and dot while the user is still typing", () => {
    expect(cleanDecimalRateDraft("2,")).toBe("2,");
    expect(cleanDecimalRateDraft("0.")).toBe("0.");
    expect(parseDecimalRateDraft("2,")).toBeNull();
  });

  it("accepts comma or dot and preserves up to four decimals", () => {
    expect(parseDecimalRateDraft("2,5")).toBe(2.5);
    expect(parseDecimalRateDraft("0.966")).toBe(0.966);
    expect(cleanDecimalRateDraft("1,23456")).toBe("1,2345");
  });

  it("commits incomplete and empty drafts safely", () => {
    expect(commitDecimalRateDraft("2,")).toBe(2);
    expect(commitDecimalRateDraft("")).toBe(0);
    expect(formatDecimalRateDraft(0.966)).toBe("0,966");
  });
});
