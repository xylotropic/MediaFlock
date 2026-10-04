import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

type Budget = { provider: number; database: number };
const budgets = new AsyncLocalStorage<Budget>();
export class WorkerDeadline extends Error {
  constructor() {
    super("Cloud operation deadline reached; retained work needs recovery.");
  }
}
export function withWorkerBudget<T>(
  milliseconds: { provider: number; database: number },
  run: () => Promise<T>,
) {
  const start = performance.now();
  const parent = budgets.getStore();
  return budgets.run(
    {
      provider: Math.min(
        start + milliseconds.provider,
        parent?.provider ?? Infinity,
      ),
      database: Math.min(
        start + milliseconds.database,
        parent?.database ?? Infinity,
      ),
    },
    run,
  );
}
export function remainingWorkerTime(lane: keyof Budget) {
  const deadline = budgets.getStore()?.[lane];
  return deadline === undefined
    ? null
    : Math.floor(deadline - performance.now());
}
export function workerTimeout(
  maximum: number,
  lane: keyof Budget = "provider",
) {
  const remaining = remainingWorkerTime(lane);
  if (remaining !== null && remaining <= 0) throw new WorkerDeadline();
  return Math.max(1, Math.min(maximum, remaining ?? maximum));
}
export function workerFetch(input: RequestInfo | URL, init?: RequestInit) {
  const remaining = remainingWorkerTime("provider");
  if (remaining === null) return fetch(input, init);
  const signal = AbortSignal.timeout(workerTimeout(20000));
  return fetch(input, {
    ...init,
    signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
  });
}
