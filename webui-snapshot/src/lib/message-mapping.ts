// Pure mapping helpers shared by MessageStore / MessagesController: turn the
// server-authored wire rows into the local ChatMessage shape. No state, no
// runes — safe to unit-test and import from anywhere.
import type { ChatMessage, Message } from './models'

/** Convert authoritative server rows into the reactive chat shape. */
export function mapMessagesToChat(msgs: Message[]): ChatMessage[] {
  return msgs.map((m, i) => ({
    id: m.id,
    role: m.role,
    status: 'complete' as const,
    createdAt: m.createdAt ?? '',
    seq: i,
    isLocal: false,
    prevId: m.prevId,
    source: m.source ?? '',
    parts: m.parts.map(p => ({
      id: p.id || `p${Date.now()}${i}`,
      type: p.type,
      text: p.text ?? '',
      tool: p.tool ?? '',
      state: p.state ?? null,
      code: p.code ?? null,
      name: p.name ?? null,
      mime: p.mime ?? null,
      size: p.size ?? null,
      width: p.width ?? null,
      height: p.height ?? null,
      durationMs: p.durationMs ?? null,
      thumbCode: p.thumbCode ?? null,
      thumbhash: p.thumbhash ?? null,
    })),
  }))
}

/** Pretty-print an unknown tool result for display (JSON for objects). */
export function pretty(o: unknown): string {
  if (typeof o === 'object' && o != null) return JSON.stringify(o, null, 2)
  return String(o)
}
