import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RANKS } from "@/lib/game-session/career";

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

  it("caseline_finalize_case IS granted to authenticated (Next.js has no other role) but never to anon", () => {
    // The security boundary is the capability-token check inside the
    // function body, not this GRANT — see the migration's own comment for
    // why revoking `authenticated` here would break the legitimate call
    // too (Next.js has no distinct database role in this architecture).
    expect(expandSql).toMatch(/grant execute on function public\.caseline_finalize_case[^;]*to authenticated/i);
    const revokeBlock = expandSql.match(/revoke all on function public\.caseline_finalize_case[^;]*;/i)?.[0] ?? "";
    expect(revokeBlock).toMatch(/\banon\b/);
    expect(revokeBlock).not.toMatch(/\bauthenticated\b/);
  });

  it("caseline_finalize_case's body checks the server capability before writing anything", () => {
    const fnBody = expandSql.match(/create or replace function public\.caseline_finalize_case[\s\S]*?\$\$;/i)?.[0] ?? "";
    const capabilityCheckLine = fnBody.search(/caseline_check_server_capability/i);
    const firstWriteLine = fnBody.search(/\bupdate public\.investigation_sessions\b/i);
    expect(capabilityCheckLine).toBeGreaterThan(-1);
    expect(firstWriteLine).toBeGreaterThan(-1);
    expect(capabilityCheckLine).toBeLessThan(firstWriteLine);
  });

  it("the capability verifier hash formula uses a versioned domain-separation label, built as bytea (text cannot hold a NUL byte)", () => {
    // Applying this migration surfaced that PostgreSQL `text` cannot
    // contain a NUL byte at all ("null character not permitted") — the
    // digest input must be built as bytea instead (a comment elsewhere in
    // this file illustrates the broken text-concatenation form for
    // context, which is why this checks the actual function body, not
    // "chr(0) appears nowhere in the file").
    const fnBody = expandSql.match(/create or replace function public\.caseline_check_server_capability[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(fnBody).toMatch(/convert_to\('caseline\/s2\/server-capability\/v1', 'UTF8'\)\s*\|\|\s*'\\x00'::bytea\s*\|\|\s*convert_to\(p_token, 'UTF8'\)/i);
    expect(fnBody).toMatch(/extensions\.digest\(/i);
    expect(fnBody).not.toMatch(/\|\|\s*chr\(0\)\s*\|\|/i);
  });

  it("caseline_check_server_capability's search_path includes extensions (pgcrypto lives there on Supabase, not public)", () => {
    const fnBody = expandSql.match(/create or replace function public\.caseline_check_server_capability[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(fnBody).toMatch(/set search_path = public, extensions, pg_temp/i);
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

  it("the SQL rank thresholds inside caseline_finalize_case exactly match lib/game-session/career.ts#RANKS (fails if they diverge)", () => {
    // Guards against exactly the risk flagged in review: SQL mirrors
    // career.ts by hand, so a future threshold change there must be
    // caught here rather than silently diverging.
    const fnBody = expandSql.match(/create or replace function public\.caseline_finalize_case[\s\S]*?\$\$;/i)?.[0] ?? "";
    for (const { name, minXp } of RANKS) {
      if (minXp === 0) continue; // the SQL CASE's `else` branch, no explicit threshold line to match
      expect(fnBody).toMatch(new RegExp(`>=\\s*${minXp}\\s+then\\s+'${name}'`, "i"));
    }
    // And nothing extra: exactly RANKS.length - 1 threshold branches (the
    // zero-floor rank is the `else`), so an added/removed SQL branch that
    // doesn't correspond to a RANKS entry also fails this test.
    const branches = fnBody.match(/when xp \+ p_xp_gained >= \d+ then '[^']+'/gi) ?? [];
    expect(branches.length).toBe(RANKS.length - 1);
  });

  it("the SQL allowed time deltas exactly match the actual UI buttons (components/shell/TopBar.tsx), not an assumption", () => {
    const topBarSrc = readFileSync(path.resolve(__dirname, "../../../components/shell/TopBar.tsx"), "utf8");
    const uiDeltas = [...topBarSrc.matchAll(/advanceTimeAction\.bind\(null,\s*(\d+)\)/g)].map((m) => Number(m[1]));
    expect(uiDeltas.sort((a, b) => a - b)).toEqual([30, 60, 240]);
    const sqlDeltas = expandSql.match(/p_minutes not in \(([^)]+)\)/i)?.[1].split(",").map((n) => Number(n.trim())) ?? [];
    expect(sqlDeltas.sort((a, b) => a - b)).toEqual(uiDeltas.sort((a, b) => a - b));
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
