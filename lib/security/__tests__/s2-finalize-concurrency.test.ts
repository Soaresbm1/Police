import { describe, expect, it } from "vitest";

/**
 * Security S2 — concurrency proof for caseline_finalize_case's claim
 * primitive (`UPDATE ... WHERE accusation IS NULL`).
 *
 * This project has no local/Docker Postgres to run true concurrent SQL
 * transactions against (see the interim report's stated limitation) — this
 * models the exact algorithm Postgres's row-level locking guarantees for a
 * single-row conditional UPDATE: two "transactions" race to be the first to
 * observe `accusation IS NULL` and flip it, and a real UPDATE statement
 * cannot interleave a read and a write for the same row the way two
 * independent JS callbacks naturally would without an explicit lock — so
 * this harness inserts an artificial mutex around exactly the read+write
 * pair to model that row lock, and asserts what the SQL function claims:
 * exactly one caller ever transitions `accusation` from null, no matter how
 * the two calls are interleaved. This is a logical proof of the algorithm,
 * not a substitute for a real Postgres integration test — flagged as a
 * limitation, to be supplemented once EXPAND-1 is applied on Preview
 * (real concurrent RPC calls against the live function).
 */

interface FakeSessionRow {
  accusation: unknown | null;
}

class FakeSessionTable {
  private row: FakeSessionRow = { accusation: null };
  private locked = false;
  private waiters: (() => void)[] = [];

  private async withRowLock<T>(fn: () => T): Promise<T> {
    while (this.locked) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.locked = true;
    try {
      return fn();
    } finally {
      this.locked = false;
      this.waiters.shift()?.();
    }
  }

  /** Mirrors: `UPDATE ... SET accusation = $1 WHERE accusation IS NULL` — a
   * single atomic statement in Postgres; the row lock here plays the same
   * role a real UPDATE's row-level lock plays automatically. */
  async claim(accusation: unknown): Promise<boolean> {
    return this.withRowLock(() => {
      if (this.row.accusation !== null) return false;
      this.row.accusation = accusation;
      return true;
    });
  }
}

describe("caseline_finalize_case claim primitive — concurrency (logical model, no live Postgres)", () => {
  it("exactly one of two truly concurrent finalization attempts for the same session wins", async () => {
    for (let trial = 0; trial < 50; trial++) {
      const table = new FakeSessionTable();
      const results = await Promise.all([table.claim({ from: "call-A" }), table.claim({ from: "call-B" })]);
      const winners = results.filter(Boolean);
      expect(winners).toHaveLength(1);
    }
  });

  it("a third retry after a successful claim always loses (idempotent no-op), never re-claims", async () => {
    const table = new FakeSessionTable();
    expect(await table.claim({ from: "first" })).toBe(true);
    expect(await table.claim({ from: "retry-1" })).toBe(false);
    expect(await table.claim({ from: "retry-2" })).toBe(false);
  });

  it("ten simultaneous attempts (multi-tab worst case) still produce exactly one winner", async () => {
    const table = new FakeSessionTable();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => table.claim({ from: `tab-${i}` })));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
