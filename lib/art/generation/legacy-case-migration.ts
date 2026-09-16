/**
 * Security S1 — lazy migration of one legacy (`CASE-XXXXXX`) case's
 * Generated Art away from its plaintext seed.
 *
 * Before S1 every row carried `case_seed = <seed>` and every uploaded object
 * lived at `{userId}/{seed}/{descriptorHash}.{ext}` — so the seed was
 * readable from the row, from a storage folder listing, and from every
 * signed image URL. For the case being migrated this:
 *
 * 1. moves each object under `{userId}/{seed}/` to `{userId}/{caseRef}/`
 *    (Storage `move` needs only the existing own-folder `select`/`update`
 *    policies — no RLS change, and nothing is deleted: the bytes are the
 *    same object under a new name, so the old folder stops existing);
 * 2. repoints every one of this user's rows that referenced the old path
 *    (the case's own rows and, defensively, any reuse row elsewhere);
 * 3. relabels the case's rows from `case_seed = <seed>` to `<caseRef>`.
 *
 * Crash-safe and idempotent: a move that already happened is detected by
 * the destination existing; a row is only relabeled once its object is at
 * the new path; anything that fails stays labeled with the legacy seed and
 * is retried on the next load. Existing assets are never deleted, and a
 * failure only ever degrades that image to the procedural fallback.
 */

export interface LegacyArtMigrationOps {
  listCaseRows(userId: string, caseKey: string): Promise<{ id: string; storagePath: string | null }[]>;
  moveObject(fromPath: string, toPath: string): Promise<boolean>;
  objectExists(path: string): Promise<boolean>;
  repointStoragePath(userId: string, fromPath: string, toPath: string): Promise<void>;
  relabelRow(userId: string, id: string, fromCaseKey: string, toCaseKey: string): Promise<void>;
}

export interface LegacyArtMigrationResult {
  rows: number;
  movedObjects: number;
  relabeledRows: number;
  failedRows: number;
}

export async function migrateLegacyCaseArt(
  ops: LegacyArtMigrationOps,
  userId: string,
  legacySeed: string,
  caseRef: string,
): Promise<LegacyArtMigrationResult> {
  const rows = await ops.listCaseRows(userId, legacySeed);
  const result: LegacyArtMigrationResult = { rows: rows.length, movedObjects: 0, relabeledRows: 0, failedRows: 0 };
  if (rows.length === 0) return result;

  const legacyPrefix = `${userId}/${legacySeed}/`;
  const failedPaths = new Set<string>();
  const legacyPaths = [...new Set(rows.map((r) => r.storagePath).filter((p): p is string => !!p && p.startsWith(legacyPrefix)))];

  for (const fromPath of legacyPaths) {
    const toPath = `${userId}/${caseRef}/${fromPath.slice(legacyPrefix.length)}`;
    try {
      const moved = await ops.moveObject(fromPath, toPath);
      if (moved) result.movedObjects++;
      else if (!(await ops.objectExists(toPath))) {
        failedPaths.add(fromPath);
        continue;
      }
      await ops.repointStoragePath(userId, fromPath, toPath);
    } catch {
      failedPaths.add(fromPath);
    }
  }

  for (const row of rows) {
    if (row.storagePath && failedPaths.has(row.storagePath)) {
      result.failedRows++;
      continue;
    }
    try {
      await ops.relabelRow(userId, row.id, legacySeed, caseRef);
      result.relabeledRows++;
    } catch {
      result.failedRows++;
    }
  }
  return result;
}
