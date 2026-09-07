import { isSupabaseConfigured } from "@/lib/supabase/config";
import { MemoryStore } from "./memory-store";
import { SupabaseSessionStore } from "./supabase-store";
import type { SessionStore } from "./types";

export type { SessionStore, PlayerProfile, PlayerSettings, CaseHistoryEntry } from "./types";

let sharedMemoryStore: MemoryStore | null = null;

/** Picks the persistence backend once per call based on whether Supabase
 * env vars are present — see DATABASE.md. The in-memory store is a module
 * singleton (state must survive across requests within this process); the
 * Supabase store is stateless and cheap to construct per request since it
 * just wraps a request-scoped client. */
export function getStore(): SessionStore {
  if (isSupabaseConfigured()) return new SupabaseSessionStore();
  if (!sharedMemoryStore) sharedMemoryStore = new MemoryStore();
  return sharedMemoryStore;
}
