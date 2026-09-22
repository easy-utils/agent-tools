<script lang="ts">
  // SessionRow — port of flutter widgets/session_row.dart. Geometry, type
  // scale, colours and the relative-time label are kept identical to the
  // Flutter implementation: avatar (honeycomb identicon) | title row
  // (name / subsession pill / expand chip / fixed 52px right-aligned stamp) |
  // preview row (subtitle + unread badge), 12px horizontal / 8px vertical.
  import type { Session } from '$lib/models'
  import { sessionName } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import ChatAvatar from '$lib/components/ChatAvatar.svelte'

  let {
    session,
    isActive = false,
    subtitle = '',
    unread = false,
    unreadCount = 0,
    selectable = false,
    selected = false,
    childCount = 0,
    expanded = false,
    isChild = false,
    onTap,
    onMenuRequest,
    menuOpen = false,
    onToggleExpand,
  }: {
    session: Session
    isActive?: boolean
    subtitle?: string
    unread?: boolean
    unreadCount?: number
    selectable?: boolean
    selected?: boolean
    childCount?: number
    expanded?: boolean
    isChild?: boolean
    onTap?: () => void
    /** Open the row's context menu. Receives the ROW's viewport rect so the
     *  menu anchors to this row (not the cursor) and the row can be
     *  highlighted. Null disables it (e.g. select mode). */
    onMenuRequest?: ((anchor: { top: number; bottom: number; left: number; right: number }) => void) | null
    /** This row's context menu is open — highlight it so the target is
     *  unambiguous. */
    menuOpen?: boolean
    onToggleExpand?: () => void
  } = $props()

  // Long-press (touch): 480ms hold without movement opens the context menu at
  // the touch point. iOS Safari never fires `contextmenu`, so the timer is the
  // ONLY mobile entry; Android fires both, and the click suppression below
  // keeps the menu-open from also navigating into the session.
  const LP_MS = 480
  let lpTimer: ReturnType<typeof setTimeout> | null = null
  let suppressTap = false

  function rowAnchor(el: HTMLElement) {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
  }

  function lpStart(e: TouchEvent) {
    if (selectable || !onMenuRequest) return
    const el = e.currentTarget as HTMLElement
    lpTimer = setTimeout(() => {
      lpTimer = null
      suppressTap = true
      navigator.vibrate?.(10)
      onMenuRequest?.(rowAnchor(el))
    }, LP_MS)
  }

  function lpCancel() {
    if (lpTimer !== null) {
      clearTimeout(lpTimer)
      lpTimer = null
    }
  }

  function lpEnd(e: TouchEvent) {
    lpCancel()
    if (suppressTap) {
      // The long-press fired: swallow the trailing click/tap so the row does
      // not ALSO open the session behind the menu.
      e.preventDefault()
      suppressTap = false
    }
  }

  /** WeChat-style relative label — one-to-one with flutter `wechatTime`. */
  function fmtTime(iso: string): string {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const mins = Math.floor((Date.now() - d.getTime()) / 60000)
    if (mins < 1) return t('timeJustNow')
    if (mins < 60) return t('timeMinAgo', { arg1: mins })
    if (mins < 60 * 24) return t('timeHour', { arg1: Math.floor(mins / 60) })
    if (mins < 60 * 24 * 7) return t('timeDay', { arg1: Math.floor(mins / (60 * 24)) })
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  const stamp = $derived(fmtTime(session.lastMessageAt || session.updatedAt))
</script>

<button
  type="button"
  class={cn(
    'flex w-full items-center px-3 py-2 text-left transition-colors select-none [-webkit-touch-callout:none]',
    selected
      ? 'bg-primary/14'
      : menuOpen
        ? 'bg-muted'
        : isActive
          ? 'bg-primary/10'
          : 'hover:bg-muted/50',
  )}
  onclick={onTap}
  oncontextmenu={e => {
    // Desktop right-click: open the ROW-anchored context menu instead of the
    // browser's own.
    if (onMenuRequest && !selectable) {
      e.preventDefault()
      onMenuRequest(rowAnchor(e.currentTarget as HTMLElement))
    }
  }}
  ontouchstart={lpStart}
  ontouchmove={lpCancel}
  ontouchend={lpEnd}
  ontouchcancel={lpCancel}
>
  {#if isChild}
    <span class="flex w-2.5 shrink-0 justify-center">
      <span class="h-[34px] w-0.5 bg-muted-foreground/35"></span>
    </span>
    <span class="w-1 shrink-0"></span>
  {/if}
  {#if selectable}
    <span
      class={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full',
        selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
      )}
    >
      {#if selected}
        <AppIcons.success class="size-4" />
      {:else}
        <span class="size-4 rounded-full border border-muted-foreground/50"></span>
      {/if}
    </span>
  {:else}
    <ChatAvatar seed={session.id} size={40} />
  {/if}
  <span class="w-3 shrink-0"></span>
  <span class="min-w-0 flex-1">
    <span class="flex items-center">
      <span class="min-w-0 flex-1 truncate text-meta font-semibold" class:text-primary={isActive}
        >{sessionName(session)}</span
      >
      {#if session.group && !isChild}
        <span class="ml-1 shrink-0 rounded-full bg-primary/14 px-1.5 py-px text-[9px] leading-none text-primary"
          >{t('subsessionBadge')}</span
        >
      {/if}
      {#if childCount > 0}
        <span
          role="button"
          tabindex="0"
          class="ml-1 flex shrink-0 cursor-pointer items-center rounded-full bg-muted-foreground/14 px-1.5 py-px text-[9px] leading-none text-muted-foreground"
          onclick={e => {
            e.stopPropagation()
            onToggleExpand?.()
          }}
          onkeydown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onToggleExpand?.()
            }
          }}
        >
          {t('subsessionCount', { arg1: childCount })}
          {#if expanded}<AppIcons.chevron_up class="size-[13px]" />{:else}<AppIcons.chevron_down class="size-[13px]" />{/if}
        </span>
      {/if}
      <!-- Fixed-width right-aligned slot: every trailing chip ends at the same
           x on every row, exactly like the Flutter implementation. -->
      <span class="w-[52px] shrink-0 text-right text-micro text-muted-foreground" style="line-height:1.4">{stamp}</span>
    </span>
    <span class="mt-0.5 flex items-center">
      <span class="min-w-0 flex-1 truncate text-micro text-muted-foreground">{subtitle || session.id}</span>
      {#if unread && !isActive && unreadCount > 0}
        <span class="ml-1 flex h-[18px] shrink-0 items-center rounded-full bg-destructive px-1.5 text-[10px] leading-none font-semibold text-white"
          >{unreadCount > 99 ? '99+' : unreadCount}</span
        >
      {/if}
    </span>
  </span>
</button>
