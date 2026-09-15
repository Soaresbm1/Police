// Vitest-only stand-in for the "server-only" package (see vitest.config.ts's
// resolve.alias). Next.js's own webpack build aliases "server-only" to a
// no-op for server bundles and to a throwing module for client bundles —
// Vitest has no such client/server bundle distinction, and every test in
// this project's `lib/**/*.test.ts` suite runs code that only ever executes
// server-side in the real app, so the correct test-time behavior is the
// same no-op Next.js itself uses for a server bundle. This file is never
// imported by application code, only by Vitest's module resolver.
export {};
