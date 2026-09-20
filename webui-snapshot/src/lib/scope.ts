// scope — the local-storage identity for the ACTIVE connection (gateway base
// URL + bearer token). The tenant lives inside the token (a client can never
// name it) and one gateway host can serve several tenants, so every
// per-connection cache is keyed by this scope: the sqlite mirror (sessions /
// messages / drafts / read watermarks) and the persisted read watermarks.
//
// WHY djb2 mod 2^31 (not FNV like the avatar): the exact same computation has
// to run in Dart, Kotlin and Swift, and on the web Flutter's ints are doubles.
// Keeping every intermediate below 2^53 makes it float-exact everywhere; the
// other clients mask with (x & 0x7fffffff), which is identical for non-negative
// values. Only needs to be stable on ONE device (each client owns its own
// store), but is byte-identical across clients anyway.
export function scopeOf(baseUrl: string, token: string): string {
  let h = 5381
  const bytes = new TextEncoder().encode(`${baseUrl}\n${token}`)
  for (const b of bytes) {
    // Math.imul keeps the product 32-bit; the AND keeps it non-negative.
    h = (Math.imul(h, 33) + b) & 0x7fffffff
  }
  return h.toString(16).padStart(8, '0')
}
