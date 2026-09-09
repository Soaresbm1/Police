import { describe, expect, it } from "vitest";
import * as assetStore from "../asset-store";

/**
 * Generated Art V2B — item S: "a shared storage object isn't deleted
 * while referenced". Audited (see the V2B report) rather than fixed,
 * because there is currently no deletion code for `generated_assets` rows
 * or Storage objects ANYWHERE in this codebase to begin with —
 * `endCurrentCase` only deletes the `investigation_sessions` row; every
 * generated-art row is deliberately permanent, matching the 0002 migration's
 * own "generated assets are meant to be permanent" comment. Since multiple
 * rows can now (V2B) reference the same `storage_path`, this invariant
 * matters going forward — this test is a regression guard: if a delete
 * function is ever added to `asset-store.ts`, this test starts failing,
 * forcing whoever adds it to read this comment and implement reference
 * counting (only delete the physical object once no remaining
 * generated_assets row points at it) rather than deleting blindly.
 */
describe("asset-store.ts — storage lifecycle safety", () => {
  it("[S] exposes no delete/remove function for generated_assets rows or storage objects", () => {
    const exportNames = Object.keys(assetStore);
    const deleteish = exportNames.filter((name) => /delete|remove/i.test(name));
    expect(deleteish).toEqual([]);
  });
});
