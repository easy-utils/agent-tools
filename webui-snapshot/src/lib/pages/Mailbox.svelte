<script lang="ts">
  // Mailbox — web port of flutter screens/overlays.dart + chat_overlay_views:
  // the session's deferred-message mailbox list with status badges.
  import type { PageProps } from '$lib/page-props'
  import { t } from '$lib/i18n.svelte'
  import type { MailboxEntry } from '$lib/models'
  import { onMount } from 'svelte'
  import { AppIcons } from '$lib/icons'

  let { store }: PageProps = $props()

  let entries = $state<MailboxEntry[]>([])
  let loading = $state(true)
  let error = $state('')

  const sid = $derived(store.activeSessionId ?? '')

  $effect(() => {
    const id = sid
    if (!id) return
    loading = true
    void (async () => {
      try {
        entries = await store.api.mailbox(id)
        error = ''
      } catch (e) {
        error = String(e)
      }
      loading = false
    })()
  })

  function fmt(iso?: string | null): string {
    if (!iso) return ''
    const d = new Date(iso)
    return isNaN(d.getTime()) ? '' : d.toLocaleString()
  }
</script>

<div class="flex h-full w-full flex-col">
  <header class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
    <button type="button" class="rounded p-1.5 hover:bg-muted" onclick={() => store.popPage()}><AppIcons.back class="size-[18px]" /></button>
    <span class="text-sm font-semibold">{t('mailbox')}</span>
  </header>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    {#if loading}
      <div class="flex justify-center py-8">
        <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
      </div>
    {:else if error}
      <p class="text-meta text-destructive">{error}</p>
    {:else if entries.length === 0}
      <p class="text-center text-meta text-muted-foreground">{t('noMessages')}</p>
    {:else}
      <div class="space-y-2">
        {#each entries as e (e.id)}
          <div class="rounded-md border border-border/60 bg-card px-3 py-2.5">
            <div class="flex items-center gap-2">
              <span class="text-micro font-semibold">{e.msgType}</span>
              <span
                class="rounded-full px-1.5 py-px text-[10px] {e.status === 'consumed' ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}"
              >{e.status}</span>
              <span class="ml-auto text-micro text-muted-foreground">{fmt(e.createdAt)}</span>
            </div>
            {#if e.payload}
              <pre class="mt-1.5 max-h-40 overflow-auto rounded-sm bg-muted/40 p-2 font-mono text-micro whitespace-pre-wrap">{e.payload}</pre>
            {/if}
            {#if e.effectiveAt}
              <div class="mt-1 text-micro text-muted-foreground">⏱ {fmt(e.effectiveAt)}</div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
