import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVisiblePoll } from "../lib/visible-poll";

describe("visible sequential polling", () => {
  let state: string;
  let events: EventTarget;
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();state = "visible";events = new EventTarget();
    vi.stubGlobal("document", {
      get visibilityState() { return state; },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    });
  });
  afterEach(() => { stop?.();vi.useRealTimers();vi.unstubAllGlobals(); });
  it("does not overlap a slow request and waits after completion", async () => {
    let finish!: () => void;
    const load = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    stop = startVisiblePoll(load, 5000, true);
    await vi.advanceTimersByTimeAsync(30000);
    expect(load).toHaveBeenCalledTimes(1);
    finish();await Promise.resolve();
    await vi.advanceTimersByTimeAsync(4999);expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);expect(load).toHaveBeenCalledTimes(2);
  });
  it("pauses hidden tabs, aborts pending reads and resumes on return", async () => {
    const load = vi.fn((signal: AbortSignal) => new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve())));
    stop = startVisiblePoll(load, 5000, true);await vi.advanceTimersByTimeAsync(1);
    const signal = load.mock.calls[0][0];state = "hidden";events.dispatchEvent(new Event("visibilitychange"));
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);expect(load).toHaveBeenCalledTimes(1);
    state = "visible";events.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(1);expect(load).toHaveBeenCalledTimes(2);
  });
  it("bounds a network wait and retries after the aborted read settles", async () => {
    const load = vi.fn((signal: AbortSignal) => new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve())));
    stop = startVisiblePoll(load, 5000, true);
    await vi.advanceTimersByTimeAsync(45001);
    expect(load).toHaveBeenCalledTimes(1);expect(load.mock.calls[0][0].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);expect(load).toHaveBeenCalledTimes(2);
  });
  it("cleanup aborts the read and never updates or restarts the old poll", async () => {
    const load = vi.fn((signal: AbortSignal) => new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve())));
    stop = startVisiblePoll(load, 5000, true);await vi.advanceTimersByTimeAsync(1);stop();
    await vi.advanceTimersByTimeAsync(60000);expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0].aborted).toBe(true);
  });
  it("starts with no traffic in a hidden tab", async () => {
    state = "hidden";const load = vi.fn(async () => {});stop = startVisiblePoll(load, 5000, true);
    await vi.advanceTimersByTimeAsync(60000);expect(load).not.toHaveBeenCalled();
  });
});
