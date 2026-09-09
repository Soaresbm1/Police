/**
 * A small, dependency-free bounded-concurrency runner — no external
 * library (e.g. `p-limit`) needed for the one place this codebase requires
 * it (`auto-portrait-trigger.ts`). Deliberately NOT `Promise.all(items.map(...))`:
 * that would burst every item at once, which is exactly what the
 * generated-art pilot's "conservative concurrency" requirement forbids.
 *
 * `concurrency` workers pull from a shared cursor over `items`, so at most
 * `concurrency` calls to `worker` are ever in flight at once, regardless of
 * how long any individual call takes. One worker's task throwing is caught
 * and stored as the result at that index rather than stopping that worker
 * (or any other) from continuing to the next item — matching this
 * codebase's own "never throws" convention for generation-pipeline calls,
 * defensively, in case a future caller's worker doesn't uphold it.
 */
export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    for (let index = nextIndex++; index < items.length; index = nextIndex++) {
      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        // `worker` is expected to never throw (every current caller already
        // resolves failures to a status value, matching pipeline.ts's own
        // "never throws" contract) — this is a defensive-only fallback so
        // one unexpected rejection can't take down this worker's remaining
        // items or, via an unhandled Promise.all rejection, the other
        // concurrent workers' already-in-flight items.
        console.error(`[CASELINE] mapWithConcurrency: worker threw for index ${index}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}
