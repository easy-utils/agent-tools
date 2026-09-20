<script lang="ts">
  // SessionList — web port of flutter screens/session_list_page.dart: search,
  // multi-select batch delete, long-press actions (delete / mark read), new
  // session (prompt), unread badges, pull-refresh, empty + error states.
  import type { PageProps } from '$lib/page-props'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { promptDialog, confirmDialog, actionSheet } from '$lib/dialogs'
  import { sessionName } from '$lib/models'
  import SessionRow from '$lib/components/SessionRow.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'

  let { store }: PageProps = $props()

  let searching = $state(false)
  let q = $state('')
  let selectMode = $state(false)
  let selected = $state<Set<string>>(new Set())
  // Subsession tree: ids the user manually expanded (collapsed by default).
  let expanded = $state<Set<string>>(new Set())
  // Pull-to-refresh (flutter RefreshIndicator): refresh when dragged from top.
  let refreshStartY: number | null = null
  let refreshing = $state(false)

  async function onTouchStart(e: TouchEvent) {
    const el = e.currentTarget as HTMLElement
    refreshStartY = el.scrollTop <= 0 ? e.touches[0]!.clientY : null
  }

  async function onTouchMove(e: TouchEvent) {
    if (refreshStartY == null || refreshing) return
    const dy = e.touches[0]!.clientY - refreshStartY
    if (dy > 64) {
      refreshing = true
      refreshStartY = null
      await store.refreshSessions()
      refreshing = false
    }
  }

  const filtered = $derived.by(() => {
    if (!q.trim()) return store.sessions
    const needle = q.trim().toLowerCase()
    return store.sessions.filter(
      s =>
        s.id.toLowerCase().includes(needle) ||
        s.lastMessagePreview.toLowerCase().includes(needle) ||
        `${s.org}:${s.repo}:${s.branch}`.toLowerCase().includes(needle),
    )
  })

  // Top-level sessions with subsessions (group == parent id) nested below when
  // expanded; orphans are promoted so nothing disappears; flat while searching.
  const display = $derived.by(() => {
    const sessions = filtered
    if (searching) return sessions
    const byId = new Map(sessions.map(s => [s.id, s]))
    const childrenOf = new Map<string, typeof sessions>()
    const top: typeof sessions = []
    for (const s of sessions) {
      if (s.group && byId.has(s.group)) {
        const list = childrenOf.get(s.group) ?? []
        list.push(s)
        childrenOf.set(s.group, list)
      } else {
        top.push(s)
      }
    }
    const out: typeof sessions = []
    for (const s of top) {
      out.push(s)
      const kids = childrenOf.get(s.id)
      if (kids?.length && expanded.has(s.id)) out.push(...kids)
    }
    return out
  })

  function childCount(id: string): number {
    return filtered.filter(s => s.group === id).length
  }

  function toggleExpand(id: string) {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    expanded = next
  }

  function exitSelect() {
    selectMode = false
    selected = new Set()
  }

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selected = next
  }

  function toggleAll() {
    if (selected.size === display.length) selected = new Set()
    else selected = new Set(display.map(s => s.id))
  }

  async function deleteSelected() {
    if (!selected.size) return
    const ok = await confirmDialog({
      title: t('deleteSessionsTitle', { n: selected.size }),
      body: t('deleteSessionsBody', { arg1: selected.size }),
      confirmLabel: t('delete'),
      destructive: true,
    })
    if (!ok) return
    const failed = await store.deleteSessions([...selected])
    if (failed.length) showErrorToast(t('deleteFailed', { n: failed.length }))
    else showToast(t('deleted'))
    exitSelect()
  }

  async function create() {
    const name = await promptDialog({ title: t('newSession'), confirmLabel: t('create') })
    if (!name) return
    try {
      await store.api.createSession({ name })
      await store.refreshSessions()
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  async function sessionActions(sid: string) {    const s = store.sessionById(sid)
    if (!s) return
    // Long-press bottom sheet equivalent: delete (+ mark-read when unread).
    const actions: string[] = []
    if (store.isUnread(s)) actions.push('read')
    actions.push('delete')
    const pick = await actionSheet({
      title: t('sessionActions'),
      actions: actions.map(a => ({ value: a, label: a === 'read' ? t('markRead') : t('deleteSession'), destructive: a === 'delete' })),
    })
    if (pick === 'read') store.markSessionRead(sid)
    else if (pick === 'delete') await deleteFlow(s.id)
  }

  async function deleteFlow(sid: string | null) {
    const ok = await confirmDialog({
      title: t('deleteSession'),
      body: sid ? t('deleteSessionBody', { arg1: sessionName(store.sessionById(sid)!) }) : '',
      confirmLabel: t('delete'),
      destructive: true,
    })
    if (!ok || !sid) return
    try {
      await store.deleteSession(sid)
      showToast(t('deleted'))
    } catch (e) {
      showErrorToast(String(e))
    }
  }

</script>

<div class="flex h-full w-full flex-col">
  <header class="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
    {#if selectMode}
      <button type="button" class="rounded p-1.5 hover:bg-muted" title={t('cancel')} onclick={exitSelect}><AppIcons.close class="size-[18px]" /></button>
      <span class="flex-1 truncate px-1 text-sm font-semibold">{t('selectedCount', { n: selected.size })}</span>
      <button type="button" class="rounded p-1.5 hover:bg-muted" title={t('selectAll')} onclick={toggleAll}><AppIcons.list class="size-[18px]" /></button>
      <button
        type="button"
        class={cn('rounded p-1.5 hover:bg-muted', selected.size ? 'text-destructive' : 'text-muted-foreground')}
        title={t('delete')}
        onclick={() => void deleteSelected()}
        disabled={!selected.size}
      ><AppIcons.delete class="size-[18px]" /></button>
    {:else if searching}
      <button
        type="button"
        class="rounded p-1.5 hover:bg-muted"
        onclick={() => {
          q = ''
          searching = false
        }}
      ><AppIcons.back class="size-[18px]" /></button>
      <input
        bind:value={q}
        class="h-9 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none"
        placeholder={t('searchHint')}
      />
    {:else}
      <span class="flex-1 truncate px-2 text-base font-semibold">{t('tabChat')}</span>
      <button type="button" class="rounded p-1.5 text-primary hover:bg-muted" title={t('search')} onclick={() => (searching = true)}><AppIcons.search class="size-[18px]" /></button>
      <button type="button" class="rounded p-1.5 text-primary hover:bg-muted" title={t('selectSessions')} onclick={() => (selectMode = true)}><AppIcons.list class="size-[18px]" /></button>
      <button type="button" class="rounded p-1.5 text-primary hover:bg-muted" title={t('newSession')} onclick={() => void create()}><AppIcons.add class="size-[18px]" /></button>
    {/if}
  </header>

  {#if store.sessionError}
    <div class="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-meta text-destructive">
      {t('connectionError')} · {store.sessionError}
    </div>
  {/if}

  <!-- Flutter keeps this label verbatim (no uppercase). -->
  <div class="px-4 pt-2 pb-1 text-micro font-semibold tracking-wider text-muted-foreground">
    {t('recent')}
  </div>

  <div
    class="min-h-0 flex-1 overflow-y-auto"
    role="list"
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
  >
    {#if display.length === 0}
      <div class="p-4 text-center text-meta text-muted-foreground">{t('noSessions')}</div>
    {:else}
      {#each display as s (s.id)}
        {@const isChild = !searching && !!s.group && filtered.some(x => x.id === s.group)}
        <SessionRow
          session={s}
          isActive={s.id === store.activeSessionId}
          subtitle={s.lastMessagePreview || s.id}
          unread={store.isUnread(s)}
          unreadCount={store.unreadCountFor(s)}
          selectable={selectMode}
          selected={selected.has(s.id)}
          childCount={isChild || searching ? 0 : childCount(s.id)}
          expanded={expanded.has(s.id)}
          isChild={isChild}
          onToggleExpand={() => toggleExpand(s.id)}
          onTap={() => (selectMode ? toggle(s.id) : store.pickSession(s.id))}
          onLongPress={selectMode ? null : () => void sessionActions(s.id)}
        />
      {/each}
    {/if}
  </div>
</div>
