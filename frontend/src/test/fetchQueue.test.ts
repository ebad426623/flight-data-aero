import { describe, expect, it, vi } from "vitest";
import { FetchQueue, jobKey } from "../lib/fetchQueue";
import type { FetchJob, FetchResult, QueueProgress } from "../lib/types";

const job = (group: string, date = "2026-12-31", extra: Partial<FetchJob> = {}): FetchJob => ({
  direction: "from_tr",
  foreign: "KHI",
  group,
  date,
  detail: false,
  force: false,
  route_days: 1,
  ...extra,
});

const ok = (delay = 0): FetchResult => ({ status: "done", error: null, next_delay_seconds: delay });

/** A runJob whose calls resolve only when the test says so. */
function controllable() {
  const calls: { job: FetchJob; resolve: (r: FetchResult) => void }[] = [];
  const runJob = vi.fn(
    (j: FetchJob) => new Promise<FetchResult>((resolve) => calls.push({ job: j, resolve })),
  );
  return { calls, runJob };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function makeQueue(runJob: (j: FetchJob) => Promise<FetchResult>, concurrency = 2) {
  const progress: QueueProgress[] = [];
  const sleeps: number[] = [];
  const onJobFinished = vi.fn();
  const queue = new FetchQueue({
    runJob,
    onProgress: (p) => progress.push(p),
    onJobFinished,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    concurrency,
  });
  queue.setView("v1");
  return { queue, progress, sleeps, onJobFinished, last: () => progress[progress.length - 1]! };
}

describe("FetchQueue", () => {
  it("runs jobs in order, at most `concurrency` at a time", async () => {
    const { calls, runJob } = controllable();
    const { queue, last } = makeQueue(runJob, 2);
    queue.offer([job("NCL"), job("MAN"), job("LON")]);
    expect(calls.map((c) => c.job.group)).toEqual(["NCL", "MAN"]);
    expect(last()).toEqual({ done: 0, total: 3, running: 2 });
    calls[0]!.resolve(ok());
    await flush();
    expect(calls.map((c) => c.job.group)).toEqual(["NCL", "MAN", "LON"]);
    calls[1]!.resolve(ok());
    calls[2]!.resolve(ok());
    await flush();
    expect(last()).toEqual({ done: 3, total: 3, running: 0 });
  });

  it("waits the server's suggested delay between requests", async () => {
    const { queue, sleeps, onJobFinished } = makeQueue(async () => ok(0.75), 1);
    queue.offer([job("NCL"), job("MAN")]);
    await flush();
    await flush();
    expect(sleeps).toEqual([750, 750]);
    expect(onJobFinished).toHaveBeenCalledTimes(2);
  });

  it("never runs the same job twice in a view", async () => {
    const runJob = vi.fn(async () => ok());
    const { queue } = makeQueue(runJob);
    queue.offer([job("NCL"), job("NCL")]);
    await flush();
    queue.offer([job("NCL")]); // e.g. a week response that was already in flight
    await flush();
    expect(runJob).toHaveBeenCalledTimes(1);
  });

  it("refresh (force) jobs bypass that and jump the queue", async () => {
    const { calls, runJob } = controllable();
    const { queue } = makeQueue(runJob, 1);
    queue.offer([job("NCL"), job("MAN"), job("LON")]);
    queue.offer([job("BRS", "2026-12-31", { force: true })], { front: true });
    calls[0]!.resolve(ok());
    await flush();
    expect(calls.map((c) => c.job.group)).toEqual(["NCL", "BRS"]);
  });

  it("drops unstarted jobs when the view changes; progress restarts", async () => {
    const { calls, runJob } = controllable();
    const { queue, last } = makeQueue(runJob, 1);
    queue.offer([job("NCL"), job("MAN")]);
    queue.setView("v2");
    expect(last()).toEqual({ done: 0, total: 0, running: 1 });
    calls[0]!.resolve(ok());
    await flush();
    expect(calls).toHaveLength(1); // MAN was never started
    expect(last().done).toBe(0); // the old view's job doesn't count toward the new view
    queue.offer([job("NCL")]); // same key, new view: allowed again
    expect(calls).toHaveLength(2);
  });

  it("re-offers busy jobs later and survives network errors", async () => {
    vi.useFakeTimers();
    try {
      const results: FetchResult[] = [
        { status: "busy", error: null, next_delay_seconds: 0 },
        ok(),
      ];
      const runJob = vi.fn(async () => results.shift()!);
      const { queue, onJobFinished } = makeQueue(runJob, 1);
      queue.offer([job("NCL")]);
      await vi.runOnlyPendingTimersAsync();
      queue.offer([job("NCL")]); // busy jobs may be offered again
      await vi.runOnlyPendingTimersAsync();
      expect(runJob).toHaveBeenCalledTimes(2);
      expect(onJobFinished.mock.calls.length).toBeGreaterThanOrEqual(3); // incl. the delayed refetch

      const failing = makeQueue(async () => {
        throw new Error("offline");
      }, 1);
      failing.queue.offer([job("MAN")]);
      await vi.runOnlyPendingTimersAsync();
      expect(failing.last()).toEqual({ done: 1, total: 1, running: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reset() allows re-running everything (after expiring the cache)", async () => {
    const runJob = vi.fn(async () => ok());
    const { queue } = makeQueue(runJob);
    queue.offer([job("NCL")]);
    await flush();
    queue.reset();
    queue.offer([job("NCL")]);
    await flush();
    expect(runJob).toHaveBeenCalledTimes(2);
  });

  it("keys jobs by route and date", () => {
    expect(jobKey(job("IST"))).toBe("from_tr:KHI:IST:2026-12-31");
  });
});
