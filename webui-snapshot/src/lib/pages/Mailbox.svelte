<script lang="ts">
  // Mailbox — the session's deferred-message queue. Renders each entry as a
  // readable CARD (never raw JSON): a type icon + label, the decoded message
  // text, attachment chips and the queued/consumed timestamps.
  import type { Component } from 'svelte'
  import type { PageProps } from '$lib/page-props'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast } from '$lib/toast.svelte'
  import type { MailboxEntry } from '$lib/models'
  import { cn } from '$lib/utils'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import { AppIcons } from '$lib/icons'

  let { store }: PageProps = $props()

  // NEWEST-FIRST, paged backward (older) as the user scrolls DOWN.
  let entries = $state<MailboxEntry[]>([])
  let loading = $state(true)
  let loadingMore = $state(false)
  let hasMore = $state(false)
  let error = $state('')

  const sid = $derived(store.activeSessionId ?? '')
  let scrollEl: HTMLElement | null = $state(null)

  $effect(() => {
    const id = sid
    if (!id) return
    loading = true
    hasMore = false
    void (async () => {
      try {
        const r = await store.api.mailbox(id)
        entries = r.entries
        hasMore = r.hasMore
        error = ''
      } catch (e) {
        error = String(e)
        // The inline error state replaces the list; also toast so the failure
        // is visible even if the page is scrolled.
        showErrorToast(t('loadError', { e: String(e) }))
      }
      loading = false
      // New content replaced the list: start at the top (newest).
      if (scrollEl) scrollEl.scrollTop = 0
    })()
  })

  /** Fetch the next-older page, anchored on the OLDEST entry we hold. */
  async function loadMore() {
    const id = sid
    const oldest = entries[entries.length - 1]
    if (!id || loadingMore || !hasMore || oldest === undefined) return
    loadingMore = true
    try {
      const r = await store.api.mailbox(id, oldest.id)
      // Append the older page at the BOTTOM (newest-first ordering).
      const seen = new Set(entries.map(e => e.id))
      entries = [...entries, ...r.entries.filter(e => !seen.has(e.id))]
      hasMore = r.hasMore
    } catch (e) {
      // Keep what we have, but surface the failed page load.
      showErrorToast(t('loadError', { e: String(e) }))
    }
    loadingMore = false
  }

  function onScroll() {
    const el = scrollEl
    if (!el || !hasMore || loadingMore) return
    // Within ~120px of the bottom: load the next-older page.
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) void loadMore()
  }

  function fmt(iso?: string | null): string {
    if (!iso) return ''
    const d = new Date(iso)
    return isNaN(d.getTime()) ? '' : d.toLocaleString()
  }

  /** Decoded view of one mailbox payload (never rendered as raw JSON). */
  interface EntryView {
    text: string
    attachmentCount: number
    attachments: Array<{ name: string; code: string }>
  }

  function viewOf(e: MailboxEntry): EntryView {
    let parsed: Record<string, unknown> | null = null
    try {
      const v = JSON.parse(e.payload)
      if (v && typeof v === 'object' && !Array.isArray(v)) parsed = v as Record<string, unknown>
    } catch {
      /* non-JSON payload: show it verbatim as text */
    }
    if (parsed === null) return { text: e.payload, attachmentCount: 0, attachments: [] }
    const text = String(parsed['text'] ?? parsed['prompt'] ?? parsed['content'] ?? '')
    const rawAtts = Array.isArray(parsed['attachments']) ? parsed['attachments'] : []
    const attachments = rawAtts
      .map(a => {
        const o = (a ?? {}) as Record<string, unknown>
        return { name: String(o['name'] ?? ''), code: String(o['code'] ?? '') }
      })
      .filter(a => a.code !== '' || a.name !== '')
    return { text, attachmentCount: attachments.length, attachments }
  }

  /**
   * Type → icon + localized label + accent, refined by SOURCE so a human
   * prompt is distinguishable from another session's hand-off or a system
   * event. `source` is an open string:
   *   `user`              -> the person's own message
   *   `session:{name}`    -> sent by another session (subsession / mail-send)
   *   `system:{name}`     -> automation
   *   anything else       -> the generic label for the type
   */
  function metaOf(
    msgType: string,
    source: string,
  ): { icon: Component; label: string; cls: string; origin: string } {
    if (msgType === 'interrupt') {
      return {
        icon: AppIcons.stop,
        label: t('mailboxInterrupt'),
        cls: 'bg-destructive/12 text-destructive',
        origin: '',
      }
    }
    if (msgType !== 'trigger') {
      return {
        icon: AppIcons.bolt,
        label: t('mailboxEvent'),
        cls: 'bg-warning/12 text-warning',
        origin: '',
      }
    }
    // A trigger that drives a turn — attribute it.
    if (source === 'user') {
      return {
        icon: AppIcons.user,
        label: t('mailboxPrompt'),
        cls: 'bg-primary/12 text-primary',
        origin: '',
      }
    }
    if (source.startsWith('session:')) {
      return {
        icon: AppIcons.mail,
        label: t('mailboxFromSession'),
        cls: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
        origin: source.slice('session:'.length),
      }
    }
    if (source.startsWith('system:')) {
      return {
        icon: AppIcons.bolt,
        label: t('mailboxFromSystem'),
        cls: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
        origin: source.slice('system:'.length),
      }
    }
    return {
      icon: AppIcons.bolt,
      label: t('mailboxPrompt'),
      cls: 'bg-primary/12 text-primary',
      origin: source,
    }
  }
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader title={t('mailbox')} onBack={() => store.popPage()}>
    {#snippet leading()}
      <AppIcons.inbox class="size-[18px] text-muted-foreground" />
    {/snippet}
    {#if entries.length}
      <span class="ml-auto rounded-full bg-muted px-2 py-0.5 text-micro text-muted-foreground tabular-nums">{entries.length}</span>
    {/if}
  </PageHeader>
  <div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto p-3" onscroll={onScroll}>
    {#if loading}
      <div class="flex justify-center py-8">
        <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
      </div>
    {:else if error}
      <p class="text-meta text-destructive">{error}</p>
    {:else if entries.length === 0}
      <EmptyState center>
        <span class="flex flex-col items-center gap-2">
          <AppIcons.inbox class="size-8 opacity-40" />
          <span>{t('noMessages')}</span>
        </span>
      </EmptyState>
    {:else}
      <div class="space-y-2">
        {#each entries as e (e.id)}
          {@const v = viewOf(e)}
          {@const m = metaOf(e.msgType, e.source)}
          {@const TypeIcon = m.icon}
          {@const pending = e.status !== 'consumed'}
          <div class="overflow-hidden rounded-lg border border-border/60 bg-card">
            <!-- card header: type icon + label + status pill -->
            <div class="flex items-center gap-2 border-b border-border/40 px-3 py-2">
              <span class={cn('flex size-6 shrink-0 items-center justify-center rounded-md', m.cls)}>
                <TypeIcon class="size-3.5" />
              </span>
              <span class="text-meta font-semibold">{m.label}</span>
              {#if m.origin}
                <span class="max-w-40 truncate text-micro text-muted-foreground" title={m.origin}>· {m.origin}</span>
              {/if}
              <span
                class={cn(
                  'ml-auto rounded-full px-1.5 py-px text-[10px] font-medium',
                  pending ? 'bg-warning/20 text-warning' : 'bg-success/20 text-success',
                )}
              >{pending ? t('mailboxPending') : t('consumed')}</span>
            </div>

            <!-- body: decoded text (never JSON) -->
            <div class="px-3 py-2.5">
              {#if v.text}
                <p class="text-body whitespace-pre-wrap break-words">{v.text}</p>
              {:else}
                <p class="text-meta text-muted-foreground italic">{t('mailboxNoContent')}</p>
              {/if}

              <!-- attachment chips -->
              {#if v.attachmentCount}
                <div class="mt-2 flex flex-wrap gap-1.5">
                  {#each v.attachments as a (a.code)}
                    <span class="inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-micro">
                      <AppIcons.attach class="size-3 shrink-0 text-muted-foreground" />
                      <span class="truncate">{a.name || a.code}</span>
                    </span>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- footer: timestamps -->
            <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border/40 px-3 py-1.5 text-micro text-muted-foreground">
              <span class="inline-flex items-center gap-1">
                <AppIcons.clock class="size-3" />
                {t('mailboxSentAt', { arg1: fmt(e.createdAt) })}
              </span>
              {#if e.consumedAt}
                <span class="inline-flex items-center gap-1">
                  <AppIcons.check class="size-3" />
                  {t('mailboxConsumedAt', { arg1: fmt(e.consumedAt) })}
                </span>
              {/if}
              {#if e.effectiveAt}
                <span class="inline-flex items-center gap-1">
                  <AppIcons.clock class="size-3" />
                  {fmt(e.effectiveAt)}
                </span>
              {/if}
            </div>
          </div>
        {/each}
        <!-- Scroll-down load-more: older entries append below. -->
        {#if loadingMore}
          <div class="flex justify-center py-3">
            <span class="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
          </div>
        {:else if !hasMore}
          <p class="py-3 text-center text-micro text-muted-foreground">{t('noMoreMessages')}</p>
        {/if}
      </div>
    {/if}
  </div>
</div>
