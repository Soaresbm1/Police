import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Security S2 — structural checks on the DRAFT migration files that don't
 * require a live database. These guard the specific properties the interim
 * report relies on: EXPAND stays additive (never revokes anything current
 * Production needs), the finalize function is never granted directly to
 * `authenticated`, and the idempotency index is a partial index (safe
 * against existing data) rather than a plain unique constraint.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const expandSql = readFileSync(path.join(MIGRATIONS_DIR, "0007_s2_expand_authoritative_mutations.sql"), "utf8");
const contractSql = readFileSync(path.join(MIGRATIONS_DIR, "0008_s2_contract_client_writes.sql"), "utf8");

describe("S2 EXPAND migration — must stay inert for current Production", () => {
  it("never revokes a pre-S2 table's existing grant or drops an existing policy", () => {
    // Revoking a privilege on a BRAND-NEW object this same file creates
    // (the capability table/functions) is a safe no-op, not a regression —
    // only revokes targeting the four pre-existing tables would break
    // current Production, so that's specifically what this checks for.
    for (const table of ["investigation_sessions", "profiles", "case_history", "generated_assets"]) {
      expect(expandSql).not.toMatch(new RegExp(`revoke[^;]*\\bon\\b[^;]*public\\.${table}\\b[^;]*from`, "i"));
    }
    expect(expandSql).not.toMatch(/\bdrop\s+policy\b/i);
  });

  it("adds session_uuid and source_session_uuid as nullable/defaulted, not breaking existing rows", () => {
    expect(expandSql).toMatch(/add column if not exists session_uuid uuid not null default gen_random_uuid\(\)/i);
    expect(expandSql).toMatch(/add column if not exists source_session_uuid uuid;/i);
    // Nullable (no `not null`) on source_session_uuid specifically.
    expect(expandSql).not.toMatch(/source_session_uuid uuid not null/i);
  });

  it("the finalize idempotency index is partial (WHERE ... IS NOT NULL), never a plain unique constraint", () => {
    expect(expandSql).toMatch(/create unique index[\s\S]*?case_history[\s\S]*?where source_session_uuid is not null/i);
  });

  it("caseline_finalize_case is explicitly revoked from authenticated/anon/public, never granted to authenticated", () => {
    const revokeBlock = expandSql.match(/revoke all on function public\.caseline_finalize_case[^;]*;/i)?.[0] ?? "";
    expect(revokeBlock).toMatch(/\bpublic\b/);
    expect(revokeBlock).toMatch(/\banon\b/);
    expect(revokeBlock).toMatch(/\bauthenticated\b/);
    expect(expandSql).not.toMatch(/grant execute on function public\.caseline_finalize_case[^;]*to authenticated/i);
  });

  it("caseline_advance_time and caseline_update_profile_preferences ARE granted to authenticated (ownership-only functions)", () => {
    expect(expandSql).toMatch(/grant execute on function public\.caseline_advance_time[^;]*to authenticated/i);
    expect(expandSql).toMatch(/grant execute on function public\.caseline_update_profile_preferences[^;]*to authenticated/i);
  });

  it("every SECURITY DEFINER function sets an explicit search_path", () => {
    const functionBlocks = expandSql.split(/create or replace function/i).slice(1);
    for (const block of functionBlocks) {
      if (/security definer/i.test(block)) {
        expect(block).toMatch(/set search_path = /i);
      }
    }
  });

  it("the capability table has RLS enabled and no policies, and all privileges revoked from anon/authenticated", () => {
    expect(expandSql).toMatch(/alter table public\.s2_server_capabilities enable row level security/i);
    expect(expandSql).not.toMatch(/create policy[^;]*s2_server_capabilities/i);
    expect(expandSql).toMatch(/revoke all on public\.s2_server_capabilities from public, anon, authenticated/i);
  });

  it("never embeds a literal secret value — only column/table/function structure", () => {
    // The capability table stores a hash column, never a literal token value.
    expect(expandSql).not.toMatch(/secret_hash\s+text\s+not\s+null\s*,\s*\n?\s*values?\s*\(/i);
    expect(expandSql).not.toMatch(/insert into public\.s2_server_capabilities/i);
  });
});

describe("S2 CONTRACT migration (draft) — the eventual restrictive end state", () => {
  it("revokes the broad UPDATE/INSERT grants this exposure report identified", () => {
    expect(contractSql).toMatch(/revoke update on public\.investigation_sessions from authenticated/i);
    expect(contractSql).toMatch(/revoke update on public\.profiles from authenticated/i);
    expect(contractSql).toMatch(/revoke insert on public\.case_history from authenticated/i);
  });

  it("re-grants only player-owned columns on investigation_sessions, never the authoritative ones", () => {
    const grantLine = contractSql.match(/grant update \(([^)]+)\) on public\.investigation_sessions to authenticated/i)?.[1] ?? "";
    const grantedColumns = grantLine.split(",").map((c) => c.trim());
    expect(grantedColumns.sort()).toEqual(["board", "notes", "player_timeline"].sort());
    for (const forbidden of ["seed", "accusation", "current_time_minutes", "evidence_status", "hint_state", "mandates"]) {
      expect(grantedColumns).not.toContain(forbidden);
    }
  });

  it("is a separate file from EXPAND, so it can be reviewed/applied independently", () => {
    expect(expandSql).not.toMatch(/revoke update on public\.investigation_sessions/i);
  });
});
