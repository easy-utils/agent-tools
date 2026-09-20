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
  import ToolPartView from './ToolPartView.svelte'
  import MediaAttachment from './MediaAttachment.svelte'
  import FileRefText from './FileRefText.svelte'

  let {
    msg,
    api,
    onUndo,
    onResend,
    onEdit,
  }: {
    msg: ChatMessage
    api: AgentApi
    onUndo: (messageId: string) => void
    onResend?: ((text: string) => void) | null
    onEdit?: ((text: string) => void) | null
  } = $props()

  const isUser = $derived(msg.role === 'user')
  const isError = $derived(msg.role === 'error')
  const isSystem = $derived(msg.role === 'system' || msg.role === 'event')
  const isStreaming = $derived(msg.status === 'streaming')

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

{#if isStreaming && ordered.length === 0}
  <div class="mb-3 flex items-center gap-2 text-micro text-muted-foreground">
    <span class="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
    {t('thinking')}
  </div>
{:else}
  <div class={cn('mb-3 flex flex-col', isSystem ? 'items-center' : isUser ? 'items-end' : 'items-start')}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class={cn(
        'min-w-0 max-w-full rounded-md border px-3 py-2.5',
        isError && 'border-destructive/40 bg-destructive/10',
        isSystem && 'border-muted-foreground/25 bg-muted/30',
        isUser && !isError && !isSystem && 'border-primary/40 bg-primary/12',
        !isUser && !isError && !isSystem && 'border-border/50 bg-card',
      )}
    >
      <div class="flex min-w-0 max-w-full flex-col items-start gap-2 text-left">
        {#if isError}
          <span class="text-micro font-semibold text-destructive">{t('error')}</span>
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

    {#if !isStreaming && !isSystem}
      <div class={cn('mt-1 flex items-center gap-0.5 text-micro text-muted-foreground', isUser ? 'justify-end' : 'justify-start')}>
        {#if hasText}
          <button type="button" class="rounded p-0.5 hover:bg-muted" title={t('copy')} aria-label={t('copy')} onclick={copy}><AppIcons.copy class="size-3.5" /></button>
        {/if}
        {#if isUser && onResend}
          <button type="button" class="rounded p-0.5 hover:bg-muted" title={t('retry')} aria-label={t('retry')} onclick={() => (retryOpen = true)}><AppIcons.refresh class="size-3.5" /></button>
        {/if}
        {#if isUser && onEdit}
          <button type="button" class="rounded p-0.5 hover:bg-muted" title={t('edit')} aria-label={t('edit')} onclick={beginEdit}><AppIcons.edit class="size-3.5" /></button>
        {/if}
        <button type="button" class="rounded p-0.5 hover:bg-muted" title={t('undo')} aria-label={t('undo')} onclick={() => (undoOpen = true)}><AppIcons.undo class="size-3.5" /></button>
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
    <textarea bind:value={editText} rows="5" class="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring"></textarea>
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
