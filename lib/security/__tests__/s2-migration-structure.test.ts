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
const expand2Sql = readFileSync(path.join(MIGRATIONS_DIR, "0009_s2_expand2_trusted_mutations.sql"), "utf8");
const createSessionSql = readFileSync(path.join(MIGRATIONS_DIR, "0010_s2_trusted_create_session.sql"), "utf8");

const EXPAND2_CAPABILITY_REQUIRED = [
  "caseline_reveal_evidence",
  "caseline_submit_to_lab",
  "caseline_request_mandate",
  "caseline_start_surveillance",
  "caseline_record_hint",
  "caseline_reseal_seed",
  "caseline_ga_create_queued",
  "caseline_ga_create_reused",
  "caseline_ga_mark_generating",
  "caseline_ga_mark_ready",
  "caseline_ga_mark_failed",
  "caseline_ga_repoint_path",
  "caseline_ga_relabel",
];
const EXPAND2_AUTHENTICATED_SEMANTIC = ["caseline_collect_evidence", "caseline_mark_event_seen", "caseline_advance_time_internal"];

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
    const grantLine = contractSql.match(/grant update \(([\s\S]+?)\) on public\.investigation_sessions to authenticated/i)?.[1] ?? "";
    const grantedColumns = grantLine.split(",").map((c) => c.trim());
    expect(grantedColumns.sort()).toEqual(
      ["board", "notes", "player_timeline", "crime_scene_examined", "crime_scene_inspected_zone_ids", "last_action_message", "last_revealed_evidence_ids"].sort(),
    );
    for (const forbidden of ["seed", "accusation", "current_time_minutes", "evidence_status", "hint_state", "mandates", "surveillance", "investigation_events", "lab_queue", "session_uuid"]) {
      expect(grantedColumns).not.toContain(forbidden);
    }
  });

  it("removes the Storage insert/update policies for a normal player, keeps select, adds no delete policy", () => {
    expect(contractSql).toMatch(/drop policy if exists "generated_art_insert_own" on storage\.objects/i);
    expect(contractSql).toMatch(/drop policy if exists "generated_art_update_own" on storage\.objects/i);
    expect(contractSql).not.toMatch(/drop policy if exists "generated_art_select_own"/i);
    expect(contractSql).not.toMatch(/create policy[^;]*generated_art[^;]*delete/i);
  });

  it("is a separate file from EXPAND, so it can be reviewed/applied independently", () => {
    expect(expandSql).not.toMatch(/revoke update on public\.investigation_sessions/i);
  });
});

describe("S2 EXPAND-2 migration (draft) — evidence/mandate/lab/surveillance/hint/Generated Art", () => {
  it("never revokes a pre-existing table's grant or drops a policy (stays additive like EXPAND-1)", () => {
    for (const table of ["investigation_sessions", "profiles", "case_history", "generated_assets"]) {
      expect(expand2Sql).not.toMatch(new RegExp(`revoke[^;]*\\bon\\b[^;]*public\\.${table}\\b[^;]*from\\s+(authenticated|anon)\\b`, "i"));
    }
    expect(expand2Sql).not.toMatch(/\bdrop\s+policy\b/i);
    expect(expand2Sql).not.toMatch(/\balter\s+table[\s\S]*?enable\s+row\s+level\s+security/i);
  });

  it("every server-capability-required function checks the capability before its first write", () => {
    for (const fn of EXPAND2_CAPABILITY_REQUIRED) {
      const fnBody = expand2Sql.match(new RegExp(`create or replace function public\\.${fn}\\b[\\s\\S]*?\\$\\$;`, "i"))?.[0] ?? "";
      expect(fnBody, `${fn} should exist`).not.toBe("");
      const capLine = fnBody.search(/caseline_check_server_capability/i);
      const firstWrite = fnBody.search(/\b(update|insert into)\s+public\./i);
      expect(capLine, `${fn} missing capability check`).toBeGreaterThan(-1);
      expect(firstWrite, `${fn} never writes`).toBeGreaterThan(-1);
      expect(capLine).toBeLessThan(firstWrite);
    }
  });

  it("every authenticated-semantic function requires NO server capability (pure DB-state/ownership check)", () => {
    for (const fn of EXPAND2_AUTHENTICATED_SEMANTIC) {
      const fnBody = expand2Sql.match(new RegExp(`create or replace function public\\.${fn}\\b[\\s\\S]*?\\$\\$;`, "i"))?.[0] ?? "";
      expect(fnBody, `${fn} should exist`).not.toBe("");
      expect(fnBody).not.toMatch(/caseline_check_server_capability/i);
      expect(fnBody).toMatch(/auth\.uid\(\)/i);
    }
  });

  it("every function is revoked from anon and never from authenticated", () => {
    const allFns = [...EXPAND2_CAPABILITY_REQUIRED, ...EXPAND2_AUTHENTICATED_SEMANTIC, "caseline_advance_time", "caseline_apply_time_effects", "caseline_append_event_if_new"];
    for (const fn of allFns) {
      const revokeBlock = expand2Sql.match(new RegExp(`revoke all on function public\\.${fn}\\([^;]*;`, "i"))?.[0] ?? "";
      expect(revokeBlock, `${fn} missing revoke-from-anon`).toMatch(/\banon\b/);
      expect(revokeBlock).not.toMatch(/\bauthenticated\b/);
    }
  });

  it("every SECURITY DEFINER function sets an explicit search_path", () => {
    const functionBlocks = expand2Sql.split(/create or replace function/i).slice(1);
    for (const block of functionBlocks) {
      if (/security definer/i.test(block)) {
        expect(block).toMatch(/set search_path = /i);
      }
    }
  });

  it("caseline_advance_time is DROPped before being redefined (return type changed, not just replaced)", () => {
    expect(expand2Sql).toMatch(/drop function if exists public\.caseline_advance_time\(uuid, integer\)/i);
  });

  it("caseline_advance_time still validates the same allowed time deltas as EXPAND-1", () => {
    const fnBody = expand2Sql.match(/create or replace function public\.caseline_advance_time\(p_session_uuid[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(fnBody).toMatch(/p_minutes not in \(30, 60, 240\)/i);
  });

  it("caseline_advance_time_internal only allows the fixed action-cost constants actually used by call sites", () => {
    const fnBody = expand2Sql.match(/create or replace function public\.caseline_advance_time_internal[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(fnBody).toMatch(/p_minutes not in \(3, 4, 5, 20\)/i);
    expect(fnBody).not.toMatch(/caseline_check_server_capability/i);
  });

  it("caseline_advance_time and caseline_advance_time_internal share the same time-effects helper (no duplicated completion logic)", () => {
    const publicBody = expand2Sql.match(/create or replace function public\.caseline_advance_time\(p_session_uuid[\s\S]*?\$\$;/i)?.[0] ?? "";
    const internalBody = expand2Sql.match(/create or replace function public\.caseline_advance_time_internal[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(publicBody).toMatch(/caseline_apply_time_effects/i);
    expect(internalBody).toMatch(/caseline_apply_time_effects/i);
  });

  it("evidence reveal never downgrades an already-advanced evidence status (monotonic)", () => {
    const fnBody = expand2Sql.match(/create or replace function public\.caseline_reveal_evidence[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(fnBody).toMatch(/if v_status ->> v_id is null then/i);
  });

  it("mandate/surveillance requests are idempotent on their key — never re-decided", () => {
    const mandateBody = expand2Sql.match(/create or replace function public\.caseline_request_mandate[\s\S]*?\$\$;/i)?.[0] ?? "";
    const surveillanceBody = expand2Sql.match(/create or replace function public\.caseline_start_surveillance[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(mandateBody).toMatch(/if v_mandates \? p_key then/i);
    expect(surveillanceBody).toMatch(/if v_surveillance \? p_key then/i);
  });

  it("hint recording only advances progress, never regresses it (escalation-only, matches hints.ts semantics)", () => {
    const fnBody = expand2Sql.match(/create or replace function public\.caseline_record_hint[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(fnBody).toMatch(/if p_level <= v_existing then/i);
  });

  it("mark_event_seen only allows ready -> seen, never scheduled -> seen", () => {
    const fnBody = expand2Sql.match(/create or replace function public\.caseline_mark_event_seen[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(fnBody).toMatch(/\(e ->> 'status'\) = 'ready'/i);
  });

  it("does not introduce a generic authoritative patch function", () => {
    expect(expand2Sql).not.toMatch(/caseline_update_investigation_state/i);
    expect(expand2Sql).not.toMatch(/create or replace function public\.caseline_[a-z_]*\(\s*p_server_token text,\s*p_session_uuid uuid,\s*p_state jsonb/i);
  });

  it("does not touch Storage — no bucket/policy/object statements", () => {
    expect(expand2Sql).not.toMatch(/insert into storage\.(objects|buckets)/i);
    expect(expand2Sql).not.toMatch(/create policy/i);
  });

  it("never embeds a literal secret value", () => {
    expect(expand2Sql).not.toMatch(/CASELINE_S2_SERVER_CAPABILITY\s*=\s*['"]/i);
  });

  it("caseline_reseal_seed is scoped by both user_id and session_uuid, and never touches any column but seed", () => {
    const fnBody = expand2Sql.match(/create or replace function public\.caseline_reseal_seed[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(fnBody).toMatch(/where s\.user_id = v_uid and s\.session_uuid = p_session_uuid and s\.seed = p_expected_seed/i);
    expect(fnBody).toMatch(/set seed = p_new_seed/i);
    expect(fnBody).not.toMatch(/set[^;]*evidence_status|set[^;]*mandates|set[^;]*current_time_minutes/i);
  });

  it("caseline_reseal_seed never references plaintext/decryption — it only compares opaque strings", () => {
    const fnBody = expand2Sql.match(/create or replace function public\.caseline_reseal_seed[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(fnBody).not.toMatch(/decrypt|plaintext|aes/i);
  });
});

describe("S2 forward-fix (0010) — trusted session creation/replacement", () => {
  const fnBody = () => createSessionSql.match(/create or replace function public\.caseline_create_session[\s\S]*?\$\$;/i)?.[0] ?? "";

  it("the function exists and is server-capability-required", () => {
    const body = fnBody();
    expect(body, "caseline_create_session should exist").not.toBe("");
    const capLine = body.search(/caseline_check_server_capability/i);
    const firstWrite = body.search(/\binsert into\s+public\./i);
    expect(capLine, "missing capability check").toBeGreaterThan(-1);
    expect(firstWrite, "never writes").toBeGreaterThan(-1);
    expect(capLine).toBeLessThan(firstWrite);
  });

  it("never accepts user_id, session_uuid, or any authoritative snapshot as a parameter — ownership and session identity are server-derived", () => {
    const signature = createSessionSql.match(/create or replace function public\.caseline_create_session\(([\s\S]*?)\)\s*\nreturns/i)?.[1] ?? "";
    expect(signature).not.toMatch(/p_user_id/i);
    expect(signature).not.toMatch(/p_session_uuid/i);
    expect(signature).not.toMatch(/p_state|p_snapshot/i);
    // Exactly the three genuinely case-specific inputs — everything else is
    // a hardcoded initial default inside the function body.
    expect(signature).toMatch(/p_server_token text/i);
    expect(signature).toMatch(/p_seed text/i);
    expect(signature).toMatch(/p_difficulty text/i);
    expect(signature).toMatch(/p_current_time_minutes integer/i);
  });

  it("derives ownership exclusively from auth.uid(), denies when unauthenticated", () => {
    const body = fnBody();
    expect(body).toMatch(/v_uid\s*:=\s*auth\.uid\(\)/i);
    expect(body).toMatch(/if v_uid is null then\s*\n\s*raise exception 'caseline: authentication required'/i);
  });

  it("generates session_uuid itself — never accepts one from the caller", () => {
    const body = fnBody();
    expect(body).toMatch(/v_new_uuid\s*:=\s*gen_random_uuid\(\)/i);
  });

  it("validates the seed is already a sealed s1e.v1 envelope — never accepts or stores plaintext", () => {
    const body = fnBody();
    expect(body).toMatch(/p_seed !~ '\^s1e\\\.v1\\\.'/);
    expect(body).not.toMatch(/decrypt|aes/i);
  });

  it("validates difficulty against the same fixed set as the rest of the app", () => {
    const body = fnBody();
    expect(body).toMatch(/p_difficulty not in \('recruit', 'investigator', 'inspector', 'expert'\)/i);
  });

  it("every universal initial value is a hardcoded literal, not a parameter", () => {
    const body = fnBody();
    for (const literal of ["'{}'::jsonb", "'[]'::jsonb", "null", "false"]) {
      expect(body).toContain(literal);
    }
  });

  it("is a single atomic INSERT ... ON CONFLICT (user_id) DO UPDATE — never a two-step delete+insert that could leave a hybrid row", () => {
    const body = fnBody();
    expect(body).toMatch(/insert into public\.investigation_sessions/i);
    expect(body).toMatch(/on conflict \(user_id\) do update set/i);
    expect(body).not.toMatch(/delete from public\.investigation_sessions/i);
  });

  it("is revoked from anon and never from authenticated", () => {
    const revokeBlock = createSessionSql.match(/revoke all on function public\.caseline_create_session\([^;]*;/i)?.[0] ?? "";
    expect(revokeBlock).toMatch(/\banon\b/);
    expect(revokeBlock).not.toMatch(/\bauthenticated\b/);
    expect(createSessionSql).toMatch(/grant execute on function public\.caseline_create_session\([^;]*\) to authenticated/i);
  });

  it("sets an explicit search_path (SECURITY DEFINER hygiene, matching every other trusted function)", () => {
    expect(fnBody()).toMatch(/set search_path = /i);
  });

  it("does not touch grants, RLS, or Storage policies — purely additive, like 0007/0009 before CONTRACT", () => {
    expect(createSessionSql).not.toMatch(/\brevoke\b[^;]*\bon\b[^;]*(table|storage)/i);
    expect(createSessionSql).not.toMatch(/\bdrop\s+policy\b/i);
    expect(createSessionSql).not.toMatch(/\bcreate\s+policy\b/i);
    expect(createSessionSql).not.toMatch(/\balter\s+table[\s\S]*?enable\s+row\s+level\s+security/i);
  });

  it("never re-opens any authoritative column on investigation_sessions to direct authenticated UPDATE", () => {
    expect(createSessionSql).not.toMatch(/grant update[\s\S]*?on public\.investigation_sessions/i);
  });

  it("never embeds a literal secret value", () => {
    expect(createSessionSql).not.toMatch(/CASELINE_S2_SERVER_CAPABILITY\s*=\s*['"]/i);
  });
});
