<script lang="ts">
  // MessageBubble — web port of flutter widgets/message_bubble.dart:
  // reasoning-first ordering, file-ref chips, foldable reasoning + compaction
  // blocks, tool cards, error styling and the hover actions row
  // (copy / retry / edit / undo with confirm).
  import type { AgentApi } from '$lib/api'
  import type { ChatMessage, ChatPart } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import { renderMarkdown } from '$lib/markdown'
  import { showToast } from '$lib/toast.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import { Dialog } from '$lib/components/ui/dialog'
  import { Textarea } from '$lib/components/ui/textarea'
  import ChatAvatar from '$lib/components/ChatAvatar.svelte'
  import ToolPartView from './ToolPartView.svelte'
  import MediaAttachment from './MediaAttachment.svelte'
  import FileRefText from './FileRefText.svelte'

  let {
    msg,
    api,
    onUndo,
    onResend,
    onEdit,
    onOpenSession,
    sessionExists,
    sessionId = '',
  }: {
    msg: ChatMessage
    api: AgentApi
    onUndo: (messageId: string) => void
    onResend?: ((text: string) => void) | null
    onEdit?: ((text: string) => void) | null
    /** Open the session named by a `session:{name}` source (jump to it). */
    onOpenSession?: ((sessionId: string) => void) | null
    /** Whether a `session:{name}` source still resolves to a live session. */
    sessionExists?: ((sessionId: string) => boolean) | null
    /** Id of the OPEN session, used to seed the assistant avatar on the left. */
    sessionId?: string
  } = $props()

  const isUser = $derived(msg.role === 'user')
  const isError = $derived(msg.role === 'error')
  const isRoleSystem = $derived(msg.role === 'system' || msg.role === 'event')
  const isStreaming = $derived(msg.status === 'streaming')
  // Optimistic user bubble awaiting the backend `message-added` confirmation:
  // a spinner sits to its LEFT and every action is hidden until it lands.
  const isSending = $derived(msg.status === 'sending')

  // ---- message ORIGIN (msg.source) ----
  //   ''            -> agent-authored row (assistant/event), or a legacy user
  //                    message with no recorded origin -> treated as `user`
  //   'user'        -> a human prompt (the reader's own message)
  //   'session:X'   -> delivered by another session (subsession / mail-send)
  //   'system:X'    -> produced by automation
  // A `session:X` message is treated as INCOMING (left-aligned, carrying the
  // SENDER's avatar) even though its role is `user`; `system:X` renders as a
  // centred notice. Only the reader's OWN prompts stay right-aligned — and,
  // per spec, carry NO avatar (avatars live on the LEFT only).
  const sourceKind = $derived<'user' | 'session' | 'system' | 'other'>(
    msg.source.startsWith('session:')
      ? 'session'
      : msg.source.startsWith('system:')
        ? 'system'
        : msg.source === '' || msg.source === 'user'
          ? 'user'
          : 'other',
  )
  /** The bare name after `session:` / `system:` ('' for user/other). */
  const sourceName = $derived(
    sourceKind === 'session'
      ? msg.source.slice('session:'.length)
      : sourceKind === 'system'
        ? msg.source.slice('system:'.length)
        : '',
  )
  // A system-sourced message renders like a system notice (centred).
  const isSystem = $derived(isRoleSystem || sourceKind === 'system')
  // The reader's OWN prompt: right-aligned, no avatar, retry/edit allowed.
  // A session hand-off has role `user` but is NOT ours.
  const isOwn = $derived(isUser && sourceKind !== 'session')
  // Left-aligned and avatar-bearing (assistant replies, session hand-offs).
  const incoming = $derived(!isOwn && !isSystem)

  // Jump-to-session is offered only while the source session still exists.
  const canOpenSession = $derived(
    sourceKind === 'session' &&
      !!onOpenSession &&
      (!sessionExists || sessionExists(sourceName)),
  )
  // Every LEFT-side avatar: a session hand-off uses the SOURCE session id; an
  // assistant reply (or any other incoming row) uses the OPEN session id.
  const avatarSeed = $derived(
    sourceKind === 'session' ? sourceName : sessionId || 'assistant',
  )
  const showAvatar = $derived(incoming && !isError && !isSending)

  // Source chip tone: sky for a session hand-off, violet for a system notice.
  const sourceChipClass = $derived(
    cn(
      'flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] leading-none font-medium',
      sourceKind === 'session'
        ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
        : 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    ),
  )

  // Reasoning always renders ABOVE the rest (stable partition).
  const ordered = $derived<ChatPart[]>([
    ...msg.parts.filter(p => p.type === 'reasoning'),
    ...msg.parts.filter(p => p.type !== 'reasoning'),
  ])

  const hasText = $derived(msg.parts.some(p => p.type === 'text' || p.type === 'reasoning'))

  // All file parts in this message (stable), so a file card can open the
  // viewer with sibling navigation (←/→) across the message's files.
  const fileRefs = $derived(
    msg.parts
      .filter(p => p.type === 'file' && p.code)
      .map(p => ({
        code: p.code as string,
        name: p.name ?? null,
        mime: p.mime ?? null,
        size: p.size ?? null,
        width: p.width ?? null,
        height: p.height ?? null,
        durationMs: p.durationMs ?? null,
        thumbCode: p.thumbCode ?? null,
        thumbhash: p.thumbhash ?? null,
      })),
  )

  let reasoningOpen = $state(false)
  let compactionOpen = $state(false)
  let editOpen = $state(false)
  let editText = $state('')
  let undoOpen = $state(false)
  let retryOpen = $state(false)

  function textOfMessage(): string {
    return msg.parts.filter(p => p.type === 'text').map(p => p.text).join('\n')
  }

  function copy() {
    const text = msg.parts
      .filter(p => p.type === 'text' || p.type === 'reasoning')
      .map(p => p.text)
      .join('\n')
    void navigator.clipboard.writeText(text).then(() => showToast(t('copied')))
  }

  function beginEdit() {
    editText = textOfMessage()
    editOpen = true
  }

  function fmtTime(iso: string): string {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const now = new Date()
    const mins = Math.floor((now.getTime() - d.getTime()) / 60000)
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    if (mins < 1) return t('timeJustNow')
    if (mins < 60) return t('timeMinAgo', { arg1: mins })
    if (d.toDateString() === now.toDateString()) return hm
    return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
  }

  // NOTE: the bubble has NO context-menu / long-press action sheet.
  // Selecting message text (notably long-press-to-select on touch) used to
  // surface a stray popup, so that whole path was removed. All message actions
  // live in the hover row below (copy / retry / edit / undo).

</script>

{#snippet chipBody()}
  {#if sourceKind === 'session'}
    <AppIcons.chat class="size-3" />
    {t('mailboxFromSession')}
  {:else}
    <AppIcons.bolt class="size-3" />
    {t('mailboxFromSystem')}
  {/if}
  {#if sourceName}<span class="opacity-80">· {sourceName}</span>{/if}
{/snippet}

{#if isStreaming && ordered.length === 0}
  <div class="mb-3 flex items-center gap-2 text-micro text-muted-foreground">
    <span class="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
    {t('thinking')}
  </div>
{:else}
  <div class={cn('mb-3 flex flex-col', isSystem ? 'items-center' : isOwn ? 'items-end' : 'items-start')}>
    <!-- Avatars live ABOVE the bubble, flush to the left edge: the assistant
         reply and a session hand-off each show a 28px avatar on its own row
         above the bubble; the reader's OWN prompt has none. The bubble below
         stays left-aligned (incoming) / right-aligned (own). -->
    {#if showAvatar}
      <div class="mb-1 flex w-full items-center">
        {#if canOpenSession}
          <!-- Session hand-off: the SOURCE session's avatar jumps to it. -->
          <button
            type="button"
            class="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={sourceName}
            aria-label={t('mailboxFromSession')}
            onclick={() => onOpenSession?.(sourceName)}
          >
            <ChatAvatar seed={avatarSeed} size={28} />
          </button>
        {:else}
          <span
            class="shrink-0"
            title={sourceKind === 'session' ? sourceName : ''}
            aria-hidden={sourceKind !== 'session'}
          >
            <ChatAvatar seed={avatarSeed} size={28} />
          </span>
        {/if}
      </div>
    {/if}
    <!-- Sending row: the spinner sits to the LEFT of the user bubble while the
         backend has not yet confirmed the write. -->
    <div class={cn('flex max-w-full items-center gap-2', isOwn ? 'flex-row' : 'flex-row-reverse')}>
    {#if isSending}
      <span
        class="size-3 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
        title={t('sending')}
        aria-label={t('sending')}
      ></span>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class={cn(
        'min-w-0 max-w-full rounded-md border px-3 py-2.5',
        isError && 'border-destructive/40 bg-destructive/10',
        isSystem && 'border-muted-foreground/25 bg-muted/30',
        sourceKind === 'session' && !isError && 'border-sky-500/40 bg-sky-500/10',
        isOwn && !isError && !isSystem && 'border-primary/40 bg-primary/12',
        !isOwn && !isError && !isSystem && sourceKind !== 'session' && 'border-border/50 bg-card',
      )}
    >
      <div class="flex min-w-0 max-w-full flex-col items-start gap-2 text-left">
        {#if isError}
          <span class="text-micro font-semibold text-destructive">
            {msg.errorKind === 'send' ? t('sendFailedTitle') : t('modelError')}
          </span>
        {/if}
        {#if sourceKind === 'session' || sourceKind === 'system'}
          <!-- Source chip: "来自会话 · {name}" / "来自系统 · {name}". The
               session chip opens that session when it still exists. -->
          {#if canOpenSession}
            <button
              type="button"
              onclick={() => onOpenSession?.(sourceName)}
              title={sourceName}
              class={sourceChipClass}
            >
              {@render chipBody()}
            </button>
          {:else}
            <span class={sourceChipClass}>{@render chipBody()}</span>
          {/if}
        {/if}
        {#each ordered as part (part.id)}
          {#if part.type === 'text'}
            <FileRefText text={part.text} {api} />
          {:else if part.type === 'file'}
            {@const f = fileRefs.find(r => r.code === part.code) ?? { code: part.code ?? '', name: part.name ?? null, mime: part.mime ?? null, size: part.size ?? null }}
            <MediaAttachment api={api} file={f} siblings={fileRefs} />
          {:else if part.type === 'reasoning'}
            <!-- flutter `_ReasoningBlock`: amber LEFT border, warning tint,
                 right-only radius, auto-expanded while streaming. -->
            <div class="w-full rounded-r-sm border-l-2 border-l-warning bg-warning/5 py-1 pr-2 pl-3">
              <button
                type="button"
                class="flex w-full items-center gap-1.5 text-left text-micro font-semibold text-warning"
                onclick={() => (reasoningOpen = !reasoningOpen)}
              >
                {#if reasoningOpen}<AppIcons.chevron_down class="size-3.5" />{:else}<AppIcons.chevron_right class="size-3.5" />{/if}
                <span>{t('thinkLabel')}{isStreaming ? '…' : ''}</span>
              </button>
              {#if reasoningOpen || isStreaming}
                <div class="md-body pt-1 text-muted-foreground">{@html renderMarkdown(part.text)}</div>
              {/if}
            </div>
          {:else if part.type === 'tool' && part.state}
            <div class="w-full">
              <ToolPartView {part} {isStreaming} {api} />
            </div>
          {:else if part.type === 'compaction'}
            <div class="w-full rounded-sm border border-border/50 bg-muted/40 px-3 py-2">
              <button
                type="button"
                class="flex w-full items-center gap-1.5 text-left text-micro text-muted-foreground"
                onclick={() => (compactionOpen = !compactionOpen)}
              >
                {#if compactionOpen}<AppIcons.chevron_down class="size-3.5" />{:else}<AppIcons.chevron_right class="size-3.5" />{/if}
                <span>{t('compactedLabel')}</span>
              </button>
              {#if compactionOpen}
                <div class="pt-1 text-meta text-muted-foreground">{part.text}</div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    </div>
    </div>

    {#if !isStreaming && !isSystem}
      <div class={cn('mt-1 flex items-center gap-0.5 text-micro text-muted-foreground', isOwn ? 'justify-end' : 'justify-start')}>
        {#if hasText}
          <button type="button" class="rounded p-0.5 hover:bg-muted" title={t('copy')} aria-label={t('copy')} onclick={copy}><AppIcons.copy class="size-3.5" /></button>
        {/if}
        <!-- undo / retry / edit stay HIDDEN while the send is unconfirmed, and
             apply ONLY to the reader's OWN prompts (never a session hand-off). -->
        {#if !isSending && isOwn && onResend}
          <button type="button" class="rounded p-0.5 hover:bg-muted" title={t('retry')} aria-label={t('retry')} onclick={() => (retryOpen = true)}><AppIcons.refresh class="size-3.5" /></button>
        {/if}
        {#if !isSending && isOwn && onEdit}
          <button type="button" class="rounded p-0.5 hover:bg-muted" title={t('edit')} aria-label={t('edit')} onclick={beginEdit}><AppIcons.edit class="size-3.5" /></button>
        {/if}
        {#if !isSending && isOwn}
          <button type="button" class="rounded p-0.5 hover:bg-muted" title={t('undo')} aria-label={t('undo')} onclick={() => (undoOpen = true)}><AppIcons.undo class="size-3.5" /></button>
        {/if}
        {#if msg.createdAt}
          <span class="ml-1 tabular-nums opacity-70">{fmtTime(msg.createdAt)}</span>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<!-- edit dialog -->
<Dialog bind:open={editOpen} title={t('editMessage')}>
  {#snippet children()}
    <Textarea bind:value={editText} rows={5} />
  {/snippet}
  {#snippet footer()}
    <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (editOpen = false)}>{t('cancel')}</button>
    <button
      type="button"
      class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80"
      onclick={() => {
        const v = editText.trim()
        editOpen = false
        if (v) onEdit?.(v)
      }}
    >{t('apply')}</button>
  {/snippet}
</Dialog>

<!-- retry confirm: withdraws this message and everything after, then resends -->
<Dialog bind:open={retryOpen} title={t('retryTitle')}>
  {#snippet children()}
    <div class="text-meta text-muted-foreground">{t('retryBody')}</div>
  {/snippet}
  {#snippet footer()}
    <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (retryOpen = false)}>{t('cancel')}</button>
    <button
      type="button"
      class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80"
      onclick={() => {
        retryOpen = false
        onResend?.(textOfMessage())
      }}
    >{t('retry')}</button>
  {/snippet}
</Dialog>

<!-- undo confirm -->
<Dialog bind:open={undoOpen} title={t('undoTitle')}>
  {#snippet children()}
    <div class="text-meta text-muted-foreground">{t('undoBody')}</div>
  {/snippet}
  {#snippet footer()}
    <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (undoOpen = false)}>{t('cancel')}</button>
    <button
      type="button"
      class="rounded-md bg-destructive px-3 py-1.5 text-sm text-white hover:bg-destructive/80"
      onclick={() => {
        undoOpen = false
        onUndo(msg.id)
      }}
    >{t('undo')}</button>
  {/snippet}
</Dialog>
