// Stream-event router — a pure translation of one server `StreamEvent` into
// MessageStore mutations. It holds no transport state; the controller owns
// dedup / run boundaries / reconnect and passes the few cross-cutting actions
// it needs (finish turn, reconcile, mailbox refresh) through `hooks`. Split out
// of messages.svelte.ts to keep the controller file about the connection.

import { filePartFrom } from './message-parts'
import type { MessageStore } from './message-store.svelte'

/** Cross-cutting actions the router invokes on the controller. */
export interface EventHooks {
  /** Turn ended: finalize streaming bubbles and pull the delta. */
  finishStreaming(): void
  /** Re-count the session's pending mailbox entries (badge). */
  refreshMailbox(): void
  /** Pull the server delta / adopt real ids. */
  reconcile(): void
  /** Drop a still-streaming local bubble. */
  clearStreaming(): void
  /** AUTHORITATIVE refetch (chain rewritten). */
  fetchMessages(): void
}

/**
 * Apply one stream event to `store`. `event`/`params` come straight from the
 * wire; routing is by the server-authored `message_id` (never invented).
 */
export function applyStreamEvent(
  store: MessageStore,
  event: string,
  params: Record<string, unknown>,
  hooks: EventHooks,
): void {
  // Every streamed part belongs to the assistant step named by its
  // server-authored `message_id` (stamped by the agent on each part). Route
  // by that id; never invent one.
  const streamMsgId = (): string | null => {
    const id = params['message_id']
    return typeof id === 'string' && id !== '' ? id : store.streamingId
  }
  switch (event) {
    case 'start-step':
    case 'text-start':
    case 'reasoning-start':
    case 'tool-input-start': {
      const sid = streamMsgId()
      if (sid == null) break
      store.ensureStreamingMsg(sid, params['prev_id'] as string | undefined)
      if (event === 'text-start' && params['id'] != null) {
        store.ensurePart(sid, params['id'] as string, 'text')
      } else if (event === 'reasoning-start' && params['id'] != null) {
        store.ensurePart(sid, `r${params['id']}`, 'reasoning')
      } else if (event === 'tool-input-start' && params['id'] != null) {
        store.startToolPart(
          sid,
          params['id'] as string,
          (params['toolName'] ?? params['name'] ?? 'tool') as string,
        )
      }
      break
    }
    case 'tool-input-delta': {
      if (params['id'] != null && params['delta'] != null) {
        store.appendToolInput(
          params['id'] as string,
          String(params['delta'] ?? ''),
        )
      }
      break
    }
    case 'text-delta':
      if (params['id'] != null && params['text'] != null) {
        const sid = streamMsgId()
        if (sid == null) break
        store.ensureStreamingMsg(sid, params['prev_id'] as string | undefined)
        store.appendDelta(
          sid,
          params['id'] as string,
          String(params['text'] ?? ''),
          false,
        )
      }
      break
    case 'reasoning-delta':
      if (params['id'] != null && params['text'] != null) {
        const sid = streamMsgId()
        if (sid == null) break
        store.ensureStreamingMsg(sid, params['prev_id'] as string | undefined)
        store.appendDelta(
          sid,
          `r${params['id']}`,
          String(params['text'] ?? ''),
          true,
        )
      }
      break
    case 'tool-call': {
      const sid = streamMsgId()
      if (sid == null) break
      store.ensureStreamingMsg(sid, params['prev_id'] as string | undefined)
      const tcId = (params['toolCallId'] ?? params['id']) as string | undefined
      if (tcId != null) {
        store.addToolPart(
          sid,
          tcId,
          (params['toolName'] ?? params['name'] ?? 'tool') as string,
          params['input'],
        )
      }
      break
    }
    case 'tool-result': {
      const tcId = (params['toolCallId'] ?? params['id']) as string | undefined
      if (tcId == null) break
      store.updateToolResult(
        tcId,
        params['formatted'] ?? params['output'] ?? params['result'],
        {
          errorMsg: undefined,
          changeId: params['change_id'] as string | undefined,
          diff: params['diff'] as string | undefined,
          additions: params['additions'] as number | undefined,
          deletions: params['deletions'] as number | undefined,
          data: (params['data'] as Record<string, unknown>) ?? undefined,
        },
      )
      break
    }
    case 'tool-error': {
      const tcId = (params['toolCallId'] ?? params['id']) as string | undefined
      const errObj = params['error']
      const errMsg = (
        typeof errObj === 'string'
          ? errObj
          : errObj && typeof errObj === 'object'
            ? ((errObj as Record<string, unknown>)['message'] ??
              params['message'] ??
              'tool error')
            : (params['message'] ?? 'tool error')
      ) as string
      if (tcId != null) store.updateToolResult(tcId, null, { errorMsg: errMsg })
      break
    }
    case 'tool-output-denied': {
      const tcId = (params['toolCallId'] ?? params['id']) as string | undefined
      if (tcId != null)
        store.updateToolResult(tcId, null, { errorMsg: 'denied' })
      break
    }
    case 'file':
    case 'reasoning-file': {
      // A streamed media part the agent has already offloaded to the blob
      // store; `code` is the file:<code> segment. Render it as a file part
      // (same path as persisted file parts). Both `file` and `reasoning-file`
      // are shown.
      const part = filePartFrom(params)
      if (part == null) break
      const sid = streamMsgId()
      if (sid == null) break
      store.ensureStreamingMsg(sid, params['prev_id'] as string | undefined)
      const existing = store.messages
        .find(m => m.id === sid)
        ?.parts.some(p => p.id === part.id)
      if (!existing) {
        store.setMsg(sid, m => ({ ...m, parts: [...m.parts, part] }))
      }
      break
    }
    case 'turn-complete':
      hooks.finishStreaming()
      hooks.refreshMailbox()
      break
    case 'message-added': {
      // The server authored this message's id and chain anchor. This is the
      // ONLY place user bubbles are created (no client-side optimistic bubble):
      // a trigger shows up here once the agent has drained the mailbox and
      // written the chain row. `streaming:true` opens the assistant step's
      // bubble; its deltas then arrive under the same id.
      const addedId =
        typeof params['message_id'] === 'string' ? params['message_id'] : ''
      const prevId =
        typeof params['prev_id'] === 'string' ? params['prev_id'] : ''
      const role =
        typeof params['role'] === 'string' ? params['role'] : 'assistant'
      const streaming = params['streaming'] === true
      const src = typeof params['source'] === 'string' ? params['source'] : ''
      if (addedId !== '') {
        if (streaming && role === 'assistant') {
          // A new step begins: any PRIOR streaming bubble is done (the server
          // persists one message per step and has moved on).
          const prevStream = store.streamingId
          if (prevStream != null && prevStream !== addedId) {
            store.messages = store.messages.map(m =>
              m.id === prevStream && m.status === 'streaming'
                ? { ...m, status: 'complete' as const }
                : m,
            )
          }
          store.streamingId = addedId
          store.ensureStreamingMsg(addedId, prevId)
        } else if (role === 'user') {
          // The prompt was persisted into the chain: render the user bubble
          // with the server-authored id/position. (The composer spinner is
          // unrelated — it already stopped at `accepted`.)
          store.upsertServerMessage(addedId, prevId, 'user', src)
        }
      }
      store.notify()
      hooks.reconcile()
      // A drained trigger is now CONSUMED, so the pending badge shrinks.
      hooks.refreshMailbox()
      break
    }
    case 'chain-changed':
      hooks.clearStreaming()
      store.sending = false
      store.notify()
      hooks.fetchMessages()
      break
    case 'status': {
      const stype = params['type']
      if (stype === 'busy' || stype === 'running') {
        store.sending = true
        store.notify()
      } else {
        hooks.finishStreaming()
      }
      break
    }
    case 'error': {
      const errObj = params['error']
      const content = (
        typeof errObj === 'string'
          ? errObj
          : errObj && typeof errObj === 'object'
            ? ((errObj as Record<string, unknown>)['message'] ??
              params['message'] ??
              'Unknown error')
            : (params['message'] ?? 'Unknown error')
      ) as string
      store.addError(content, 'model')
      store.sending = false
      store.notify()
      break
    }
    default:
      break
  }
}
