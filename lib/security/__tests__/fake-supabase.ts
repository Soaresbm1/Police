/**
 * Security S1 test support — a small in-memory stand-in for the parts of the
 * Supabase client the session store and Generated Art store actually use
 * (PostgREST filters/updates/upserts on plain tables, plus Storage
 * move/exists/upload/signed URLs). Deliberately permissive where the real
 * API is permissive and never simulates RLS: the S1 guarantees under test
 * are about WHAT the server writes into rows a player can already read.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export interface RecordedWrite {
  table: string;
  op: "insert" | "update" | "upsert" | "delete";
  payload: Row | null;
}

export const FAKE_SUPABASE_ORIGIN = "https://fakeprojectref00000000.supabase.co";

class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string } | null; count?: number }> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row | null = null;
  private filters: Filter[] = [];
  private cardinality: "many" | "maybeSingle" | "single" = "many";
  private headCount = false;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    if (options?.head) this.headCount = true;
    return this;
  }
  insert(row: Row) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  upsert(row: Row) {
    this.op = "upsert";
    this.payload = row;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((r) => r[column] !== value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((r) => (r[column] ?? null) === value);
    return this;
  }
  not(column: string, operator: string, literal: string) {
    if (operator !== "in") throw new Error(`fake: unsupported not(${operator})`);
    const values = literal
      .replace(/^\(|\)$/g, "")
      .split(",")
      .map((v) => v.replace(/^"|"$/g, ""));
    this.filters.push((r) => !values.includes(String(r[column])));
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle() {
    this.cardinality = "maybeSingle";
    return this;
  }
  single() {
    this.cardinality = "single";
    return this;
  }

  then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string } | null; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onfulfilled, onrejected);
  }

  private execute(): { data: unknown; error: { message: string } | null; count?: number } {
    const injected = this.db.failNext.get(`${this.table}:${this.op}`);
    if (injected && injected > 0) {
      this.db.failNext.set(`${this.table}:${this.op}`, injected - 1);
      return { data: null, error: { message: "injected failure" } };
    }
    const rows = (this.db.tables[this.table] ??= []);
    const matches = () => rows.filter((r) => this.filters.every((f) => f(r)));
    let result: Row[];

    switch (this.op) {
      case "select":
        result = matches().map((r) => ({ ...r }));
        if (this.headCount) return { data: null, error: null, count: result.length };
        break;
      case "insert": {
        const row = { id: `row-${++this.db.nextId}`, ...this.payload };
        rows.push(row);
        this.db.writes.push({ table: this.table, op: "insert", payload: { ...this.payload } });
        result = [{ ...row }];
        break;
      }
      case "upsert": {
        const payload = this.payload!;
        const existing = rows.find((r) => r.user_id === payload.user_id);
        if (existing) Object.assign(existing, payload);
        else rows.push({ ...payload });
        this.db.writes.push({ table: this.table, op: "upsert", payload: { ...payload } });
        result = [{ ...(existing ?? payload) }];
        break;
      }
      case "update": {
        const hit = matches();
        for (const r of hit) Object.assign(r, this.payload);
        this.db.writes.push({ table: this.table, op: "update", payload: { ...this.payload } });
        result = hit.map((r) => ({ ...r }));
        break;
      }
      case "delete": {
        const hit = matches();
        this.db.tables[this.table] = rows.filter((r) => !hit.includes(r));
        this.db.writes.push({ table: this.table, op: "delete", payload: null });
        result = hit;
        break;
      }
    }

    if (this.cardinality === "many") return { data: result, error: null };
    if (result.length > 1) return { data: null, error: { message: "multiple rows" } };
    if (this.cardinality === "single" && result.length === 0) return { data: null, error: { message: "no rows" } };
    return { data: result[0] ?? null, error: null };
  }
}

export class FakeSupabase {
  tables: Record<string, Row[]> = { investigation_sessions: [], generated_assets: [], case_history: [], profiles: [] };
  objects = new Map<string, string>();
  writes: RecordedWrite[] = [];
  storageOps: string[] = [];
  failNext = new Map<string, number>();
  failMoves = new Set<string>();
  nextId = 0;

  from(table: string) {
    return new FakeQuery(this, table);
  }

  storage = {
    from: () => ({
      move: async (from: string, to: string) => {
        this.storageOps.push(`move`);
        if (this.failMoves.has(from) || !this.objects.has(from) || this.objects.has(to)) {
          return { data: null, error: { message: "move failed" } };
        }
        this.objects.set(to, this.objects.get(from)!);
        this.objects.delete(from);
        return { data: { message: "Successfully moved" }, error: null };
      },
      exists: async (path: string) => ({ data: this.objects.has(path), error: null }),
      upload: async (path: string) => {
        this.objects.set(path, "bytes");
        return { data: { path }, error: null };
      },
      createSignedUrl: async (path: string) => ({ data: { signedUrl: signedUrlFor(path) }, error: null }),
      createSignedUrls: async (paths: string[]) => ({
        data: paths.map((path) => ({ path, signedUrl: signedUrlFor(path), error: null })),
        error: null,
      }),
    }),
  };
}

/** Same shape as a real Supabase signed URL: the object path is in clear
 * text in the URL, and also inside the token's JWT payload. */
function signedUrlFor(path: string): string {
  const payload = Buffer.from(JSON.stringify({ url: `generated-art/${path}`, iat: 1 })).toString("base64url");
  return `${FAKE_SUPABASE_ORIGIN}/storage/v1/object/sign/generated-art/${encodeURI(path)}?token=eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;
}
