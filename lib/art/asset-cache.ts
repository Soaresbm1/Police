import { createHash } from "node:crypto";

/**
 * `descriptorHash → asset` cache. Every procedural renderer here is a pure
 * function of its descriptor, so caching is purely a performance layer —
 * correctness never depends on it (a cache miss just recomputes the same
 * deterministic SVG string).
 *
 * In-memory only, per server process, for now. A generated case's visuals
 * should remain consistent forever, so the natural next step is a durable
 * store (e.g. Supabase Storage, keyed the same way) — not implemented yet
 * since nothing in this milestone requires it to survive a process
 * restart; swapping the `Map` below for a Storage-backed lookup is the
 * only change a future persistent cache would need.
 *
 * Server-only (uses `node:crypto`) — everything that imports this file
 * today is a Server Component/Server Action; do not import it from a
 * "use client" file.
 */
const cache = new Map<string, string>();

/** Stable hash of any JSON-serializable descriptor object — sorts keys so
 * property order never changes the hash. A real SHA-256 hex digest, not
 * just the serialized JSON: the descriptor hash is also used verbatim as
 * a Supabase Storage object-key path segment
 * (`{userId}/{caseSeed}/{descriptorHash}.{ext}`, see
 * `lib/art/generation/asset-store.ts`), and Storage keys reject `{`, `"`,
 * `:`, and other JSON punctuation — a raw JSON string is not a valid path
 * segment. */
export function hashDescriptor(descriptor: unknown): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, normalize(v)]),
      );
    }
    return value;
  };
  const json = JSON.stringify(normalize(descriptor));
  return createHash("sha256").update(json).digest("hex");
}

export function getCachedAsset(key: string): string | undefined {
  return cache.get(key);
}

export function setCachedAsset(key: string, asset: string): void {
  cache.set(key, asset);
}

/** Computes and caches in one call — the shape every renderer wiring uses. */
export function cachedAsset(descriptor: unknown, compute: () => string): string {
  const key = hashDescriptor(descriptor);
  const existing = cache.get(key);
  if (existing !== undefined) return existing;
  const asset = compute();
  cache.set(key, asset);
  return asset;
}
