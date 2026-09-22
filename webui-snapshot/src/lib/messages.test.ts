// MessagesController state-machine tests: the server-driven message flow
// (message-added → deltas → tool parts → turn-complete → reconcile) driven
// through a scripted fake AgentApi + push-channel watchSession stream. No
// DOM, no local store (in-memory merge path).
//
// The fake mirrors the REAL server persistence discipline: a chain row is
// inserted BEFORE its `message-added` event is emitted, and `messagesAfter`
// serves everything after the client's tip anchor. Tests push rows and
// events in the same order the agent produces them.
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentApi } from './api'
import { connection } from './connection.svelte'
import { makeStreamEvent, type StreamEvent } from './events'
import { MessagesController } from './messages.svelte'
import type { MailboxEntry, Message } from './models'

/** Push-able async generator standing in for `api.streamEvents`. */
class Chan {
  private q: StreamEvent[] = []
  private closed = false
  private wake: (() => void) | null = null

  push(ev: StreamEvent): void {
    this.q.push(ev)
    this.wake?.()
  }

  close(): void {
    this.closed = true
    this.wake?.()
  }

  /** Simulate the socket coming back (used by reconnect tests). */
  reopen(): void {
    this.closed = false
  }

  async *run(signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    let i = 0
    while (!(signal?.aborted ?? false)) {
      while (i < this.q.length) yield this.q[i++]!
      if (this.closed) return
      await new Promise<void>(resolve => {
        this.wake = resolve
        signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      this.wake = null
    }
  }
}

/**
 * A faithful in-memory stand-in for the agent's message surface: the chain
 * rows the server has PERSISTED so far. `messagesAfter` serves exactly the
// rows after the caller's anchor, like the real ListMessages{after} RPC.
 */
class FakeServer {
  readonly chain: Message[] = []
  readonly chan = new Chan()
  private promptErr: Error | null = null
  private mailboxEntries: MailboxEntry[] = []
  private status = 'idle'

  failPrompts(e: Error): void {
    this.promptErr = e
  }

  clearPromptError(): void {
    this.promptErr = null
  }

  setMailbox(entries: MailboxEntry[]): void {
    this.mailboxEntries = entries
  }

  setStatus(s: string): void {
    this.status = s
  }

  /** Persist a chain row (what persistUserPrompt/persistStep did server-side). */
  persist(msg: Message): void {
    this.chain.push(msg)
  }

  api(): AgentApi {
    const self = this
    return {
      prompt: async (_id: string, _text: string, _codes: string[] = []) => {
        if (self.promptErr) throw self.promptErr
        return 'accepted'
      },
      messages: async (): Promise<[Message[], boolean]> => [
        [...self.chain],
        false,
      ],
      messagesAfter: async (
        _id: string,
        after: string,
      ): Promise<{ messages: Message[]; resync: boolean; tipId: string }> => {
        const tip = self.chain.length
          ? self.chain[self.chain.length - 1]!.id
          : ''
        if (after === '')
          return { messages: [...self.chain], resync: false, tipId: tip }
        const i = self.chain.findIndex(m => m.id === after)
        if (i < 0)
          return { messages: [...self.chain], resync: true, tipId: tip }
        return { messages: self.chain.slice(i + 1), resync: false, tipId: tip }
      },
      state: async (): Promise<[string, unknown[]]> => [self.status, []],
      mailbox: async (): Promise<{
        entries: MailboxEntry[]
        hasMore: boolean
      }> => ({
        entries: [...self.mailboxEntries],
        hasMore: false,
      }),
      streamEvents: async function* (
        _sid: string,
        _since = '',
        signal?: AbortSignal,
      ) {
        yield* self.chan.run(signal)
      },
    } as unknown as AgentApi
  }
}

/** Let queued microtasks (handleEvent chains, void reconcile()) settle. */
async function flush(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise(r => setTimeout(r, 0))
}

const SID = 's1'
let eid = 0
const ev = (
  event: string,
  params: Record<string, unknown> = {},
  runId = 'r1',
): StreamEvent => makeStreamEvent(event, params, `e${eid++}`, runId)

function serverMsg(
  id: string,
  role: string,
  prevId: string,
  parts: Message['parts'],
): Message {
  return {
    id,
    role,
    parts,
    prevId,
    source: '',
    createdAt: new Date().toISOString(),
  }
}

const rigs: Array<{ ctrl: MessagesController }> = []

function boot(): { ctrl: MessagesController; server: FakeServer } {
  const server = new FakeServer()
  const ctrl = new MessagesController(server.api(), () => SID, null)
  rigs.push({ ctrl })
  ctrl.init()
  return { ctrl, server }
}

afterEach(() => {
  for (const r of rigs) r.ctrl.dispose()
  rigs.length = 0
  connection.chat = false
})

describe('MessagesController connection banner', () => {
  it('raises the banner when the stream drops and clears it on a live event', async () => {
    const { ctrl, server } = boot()
    await flush()
    expect(connection.chat).toBe(false)

    // Drop the stream: the controller must flag reconnecting.
    server.chan.close()
    await flush(3)
    expect(connection.chat).toBe(true)

    // The socket comes back; wait out the first backoff (~1s), then a live
    // event proves the connection is healthy again.
    server.chan.reopen()
    await new Promise(r => setTimeout(r, 1200))
    server.chan.push(ev('status', { type: 'idle' }))
    await flush(3)
    expect(connection.chat).toBe(false)
    ctrl.dispose()
  })

  it('clears the banner when the controller is disposed', async () => {
    const { ctrl, server } = boot()
    await flush()
    server.chan.close()
    await flush(3)
    expect(connection.chat).toBe(true)
    ctrl.dispose()
    expect(connection.chat).toBe(false)
  })
})

describe('MessagesController (server-driven state machine)', () => {
  it('boots an empty session without optimistic bubbles', async () => {
    const { ctrl } = boot()
    await flush()
    expect(ctrl.messages).toHaveLength(0)
    expect(ctrl.sending).toBe(false)
    expect(ctrl.awaitingSend).toBe(false)
  })

  it('happy path: user bubble from message-added, streamed step, tool part, turn-complete, reconcile', async () => {
    const { ctrl, server } = boot()
    await flush()

    // Send: spinner while the RPC is in flight, cleared at `accepted`, and
    // NO optimistic user bubble is created.
    const p = ctrl.deliver('hi')
    expect(ctrl.awaitingSend).toBe(true)
    await p
    expect(ctrl.awaitingSend).toBe(false)
    expect(ctrl.messages).toHaveLength(0)

    server.setStatus('busy')
    server.persist(
      serverMsg('u1', 'user', '', [{ id: 'p0', type: 'text', text: 'hi' }]),
    )
    server.chan.push(ev('status', { type: 'busy' }))
    server.chan.push(
      ev('message-added', {
        message_id: 'u1',
        prev_id: '',
        role: 'user',
        streaming: false,
      }),
    )
    server.chan.push(
      ev('message-added', {
        message_id: 'a1',
        prev_id: 'u1',
        role: 'assistant',
        streaming: true,
      }),
    )
    server.chan.push(
      ev('text-start', { id: 't0', message_id: 'a1', prev_id: 'u1' }),
    )
    server.chan.push(
      ev('text-delta', { id: 't0', text: 'Hello', message_id: 'a1' }),
    )
    server.chan.push(
      ev('text-delta', { id: 't0', text: ' world', message_id: 'a1' }),
    )
    await flush(4)

    // Mid-stream: exactly one user + one streaming assistant bubble.
    expect(ctrl.messages.map(m => m.id)).toEqual(['u1', 'a1'])
    const a1 = ctrl.messages.find(m => m.id === 'a1')
    expect(a1?.status).toBe('streaming')
    expect(a1?.parts.map(p => p.text).join('')).toBe('Hello world')
    expect(ctrl.sending).toBe(true)

    // A tool call streams in and completes within the same step.
    server.chan.push(
      ev('tool-input-start', {
        id: 'tc1',
        toolName: 'web.search',
        message_id: 'a1',
      }),
    )
    server.chan.push(ev('tool-input-delta', { id: 'tc1', delta: '{"q":"x"}' }))
    server.chan.push(
      ev('tool-call', {
        toolCallId: 'tc1',
        toolName: 'web.search',
        input: { q: 'x' },
        message_id: 'a1',
      }),
    )
    server.chan.push(
      ev('tool-result', {
        toolCallId: 'tc1',
        output: 'found 1',
        message_id: 'a1',
      }),
    )
    await flush(3)
    const tool = ctrl.messages
      .find(m => m.id === 'a1')
      ?.parts.find(p => p.id === 'tc1')
    expect(tool?.type).toBe('tool')
    expect(tool?.state?.status).toBe('complete')
    expect(tool?.state?.input).toEqual({ q: 'x' })
    expect(tool?.state?.output).toBe('found 1')

    // Turn ends; reconcile adopts the server rows under the same ids.
    server.persist(
      serverMsg('a1', 'assistant', 'u1', [
        { id: 't0', type: 'text', text: 'Hello world' },
        { id: 'tc1', type: 'tool_result', tool: 'web.search' },
      ]),
    )
    server.setStatus('idle')
    server.chan.push(ev('turn-complete', { reason: 'stop' }))
    await flush()
    expect(ctrl.sending).toBe(false)
    expect(ctrl.messages).toHaveLength(2)
    const sorted = ctrl.sorted
    expect(sorted.map(m => m.id)).toEqual(['u1', 'a1'])
    expect(sorted[1]!.status).toBe('complete')
    expect(sorted[1]!.isLocal).toBe(false)
    expect(ctrl.messages.filter(m => m.id === 'a1')).toHaveLength(1)
  })

  it('replay reorder: a delta arriving before message-added does not duplicate the bubble', async () => {
    const { ctrl, server } = boot()
    await flush()
    server.chan.push(
      ev('text-delta', { id: 't0', text: 'Hi', message_id: 'a1', prev_id: '' }),
    )
    await flush(3)
    expect(ctrl.messages.filter(m => m.id === 'a1')).toHaveLength(1)

    server.chan.push(
      ev('message-added', {
        message_id: 'a1',
        prev_id: '',
        role: 'assistant',
        streaming: true,
      }),
    )
    await flush(3)
    const hits = ctrl.messages.filter(m => m.id === 'a1')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.parts.map(p => p.text).join('')).toBe('Hi')
    expect(hits[0]!.status).toBe('streaming')
  })

  it('multi-step turn: a new step message-added finalizes the prior streaming bubble', async () => {
    const { ctrl, server } = boot()
    await flush()

    server.chan.push(
      ev('message-added', {
        message_id: 'a1',
        prev_id: '',
        role: 'assistant',
        streaming: true,
      }),
    )
    server.chan.push(
      ev('text-delta', { id: 't0', text: 'step one', message_id: 'a1' }),
    )
    await flush(3)
    expect(ctrl.messages.find(m => m.id === 'a1')?.status).toBe('streaming')

    // Step 1 is persisted before step 2 announces itself (server discipline).
    server.persist(
      serverMsg('a1', 'assistant', '', [
        { id: 't0', type: 'text', text: 'step one' },
      ]),
    )
    server.chan.push(
      ev('message-added', {
        message_id: 'a2',
        prev_id: 'a1',
        role: 'assistant',
        streaming: true,
      }),
    )
    await flush(4)
    expect(ctrl.messages.find(m => m.id === 'a1')?.status).toBe('complete')
    expect(ctrl.messages.find(m => m.id === 'a2')?.status).toBe('streaming')

    server.chan.push(
      ev('text-delta', { id: 't1', text: 'step two', message_id: 'a2' }),
    )
    server.persist(
      serverMsg('a2', 'assistant', 'a1', [
        { id: 't1', type: 'text', text: 'step two' },
      ]),
    )
    server.chan.push(ev('turn-complete', { reason: 'stop' }))
    await flush()
    expect(ctrl.messages.map(m => m.id)).toEqual(['a1', 'a2'])
    expect(ctrl.messages.every(m => m.status === 'complete')).toBe(true)
    expect(ctrl.messages.every(m => !m.isLocal)).toBe(true)
  })

  it('eid dedup: a replayed event is applied exactly once', async () => {
    const { ctrl, server } = boot()
    await flush()
    const once = makeStreamEvent(
      'text-delta',
      { id: 't0', text: 'Ha', message_id: 'a1', prev_id: '' },
      'dup-eid',
      'r1',
    )
    server.chan.push(
      ev('message-added', {
        message_id: 'a1',
        prev_id: '',
        role: 'assistant',
        streaming: true,
      }),
    )
    server.chan.push(once)
    server.chan.push(once)
    server.chan.push(once)
    await flush(3)
    expect(ctrl.messages.filter(m => m.id === 'a1')).toHaveLength(1)
    expect(
      ctrl.messages
        .find(m => m.id === 'a1')
        ?.parts.map(p => p.text)
        .join(''),
    ).toBe('Ha')
  })

  it('reconnect replay: deltas for a PERSISTED step do not duplicate its parts', async () => {
    const { ctrl, server } = boot()
    await flush()
    // A step streamed live, then persisted (server rows carry their own ids).
    server.chan.push(
      ev('message-added', {
        message_id: 'a1',
        prev_id: '',
        role: 'assistant',
        streaming: true,
      }),
    )
    server.chan.push(
      ev('text-delta', { id: 't0', text: 'Hello', message_id: 'a1' }),
    )
    server.chan.push(
      ev('reasoning-delta', { id: 'r0', text: 'think', message_id: 'a1' }),
    )
    server.persist(
      serverMsg('a1', 'assistant', '', [
        { id: 'srv-t0', type: 'text', text: 'Hello' },
        { id: 'srv-r0', type: 'reasoning', text: 'think' },
      ]),
    )
    server.chan.push(ev('turn-complete', { reason: 'stop' }))
    await flush()
    const before = ctrl.messages.find(m => m.id === 'a1')!
    expect(before.isLocal).toBe(false)
    expect(before.parts).toHaveLength(2)

    // Reconnect: the server replays the SAME deltas with the STREAM ids. They
    // must be ignored — the persisted parts use different ids.
    server.chan.push(
      ev('text-delta', { id: 't0', text: 'Hello', message_id: 'a1' }),
    )
    server.chan.push(
      ev('reasoning-delta', { id: 'r0', text: 'think', message_id: 'a1' }),
    )
    await flush(3)
    const after = ctrl.messages.find(m => m.id === 'a1')!
    expect(after.parts).toHaveLength(2)
    expect(after.parts.filter(p => p.type === 'reasoning')).toHaveLength(1)
    expect(
      after.parts
        .filter(p => p.type === 'text')
        .map(p => p.text)
        .join(''),
    ).toBe('Hello')
  })

  it('live delta for a still-LOCAL step still appends', async () => {
    const { ctrl, server } = boot()
    await flush()
    server.chan.push(
      ev('message-added', {
        message_id: 'a1',
        prev_id: '',
        role: 'assistant',
        streaming: true,
      }),
    )
    server.chan.push(
      ev('text-delta', { id: 't0', text: 'a', message_id: 'a1' }),
    )
    server.chan.push(
      ev('text-delta', { id: 't0', text: 'b', message_id: 'a1' }),
    )
    await flush(3)
    const m = ctrl.messages.find(x => x.id === 'a1')!
    expect(m.isLocal).toBe(true)
    expect(m.parts.map(p => p.text).join('')).toBe('ab')
  })

  it('tool-error marks the part error and keeps the bubble', async () => {
    const { ctrl, server } = boot()
    await flush()
    server.chan.push(
      ev('message-added', {
        message_id: 'a1',
        prev_id: '',
        role: 'assistant',
        streaming: true,
      }),
    )
    server.chan.push(
      ev('tool-call', {
        toolCallId: 'tc9',
        toolName: 'boom',
        message_id: 'a1',
      }),
    )
    server.chan.push(
      ev('tool-error', {
        toolCallId: 'tc9',
        error: { message: 'kaput' },
        message_id: 'a1',
      }),
    )
    await flush(3)
    const tool = ctrl.messages
      .find(m => m.id === 'a1')
      ?.parts.find(p => p.id === 'tc9')
    expect(tool?.state?.status).toBe('error')
    expect(tool?.state?.error).toBe('kaput')
  })

  it('a model error event adds a local error bubble and clears sending', async () => {
    const { ctrl, server } = boot()
    await flush()
    server.chan.push(ev('status', { type: 'busy' }))
    server.chan.push(
      ev('message-added', {
        message_id: 'a1',
        prev_id: '',
        role: 'assistant',
        streaming: true,
      }),
    )
    await flush(3)
    expect(ctrl.sending).toBe(true)
    server.chan.push(ev('error', { error: { message: 'upstream 500' } }))
    await flush(3)
    expect(ctrl.sending).toBe(false)
    const err = ctrl.messages.find(m => m.role === 'error')
    expect(err?.status).toBe('error')
    expect(err?.isLocal).toBe(true)
    expect(err?.errorKind).toBe('model')
    expect(err?.parts[0]?.text).toContain('upstream 500')
  })

  it('deliver failure surfaces a send error bubble and resets awaitingSend', async () => {
    const { ctrl, server } = boot()
    server.failPrompts(new Error('mailbox down'))
    await flush()
    await expect(ctrl.deliver('hi')).rejects.toThrow('mailbox down')
    expect(ctrl.awaitingSend).toBe(false)
    const err = ctrl.messages.find(m => m.role === 'error')
    expect(err?.errorKind).toBe('send')
    expect(err?.parts[0]?.text).toContain('mailbox down')
  })

  it('sending a new prompt clears a prior error bubble (transient state)', async () => {
    const { ctrl, server } = boot()
    server.failPrompts(new Error('mailbox down'))
    await flush()
    await expect(ctrl.deliver('hi')).rejects.toThrow('mailbox down')
    expect(ctrl.messages.some(m => m.role === 'error')).toBe(true)

    // The next send clears it BEFORE the RPC — even if this one also fails.
    server.clearPromptError()
    const p = ctrl.deliver('again')
    expect(ctrl.messages.some(m => m.role === 'error')).toBe(false)
    await p
    expect(ctrl.messages.some(m => m.role === 'error')).toBe(false)
  })

  it('pendingMailbox counts non-consumed entries on boot', async () => {
    const mb = (id: string, status: string): MailboxEntry =>
      ({
        id,
        msgType: 'trigger',
        source: 'user',
        payload: {},
        effectiveAt: null,
        status,
        createdAt: '2026-01-01T00:00:00Z',
        consumedAt: null,
      }) as MailboxEntry
    const { ctrl, server } = boot()
    server.setMailbox([
      mb('m1', 'pending'),
      mb('m2', 'pending'),
      mb('m3', 'consumed'),
    ])
    await flush()
    expect(ctrl.pendingMailbox).toBe(2)
  })

  it('chain-changed triggers an authoritative refetch', async () => {
    const { ctrl, server } = boot()
    server.persist(
      serverMsg('u1', 'user', '', [{ id: 'p0', type: 'text', text: 'old' }]),
    )
    await flush()
    expect(ctrl.messages.map(m => m.id)).toEqual(['u1'])
    server.chan.push(ev('chain-changed', {}))
    await flush()
    // fetchMessages re-runs the baseline (the fake chain still holds u1).
    expect(ctrl.messages.map(m => m.id)).toEqual(['u1'])
    expect(ctrl.messages[0]!.parts[0]!.text).toBe('old')
  })
})
