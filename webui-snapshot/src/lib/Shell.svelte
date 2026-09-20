<script lang="ts">
  // Shell — web port of flutter _Shell + app_layout.dart: phones (<640px) get
  // a bottom tab bar (hidden while a chat is open), tablets a left rail
  // (96px), and per-tab content renders the last 1 (phone) / 2 (tablet) pages
  // of the navigation stack side by side.
  import type { Component } from 'svelte'
  import type { AppPage, AppStore } from './store.svelte'
  import type { PageProps } from './page-props'
  import { t } from './i18n.svelte'
  import { cn } from './utils'
  import { AppIcons } from '$lib/icons'
  import SessionList from './pages/SessionList.svelte'
  import Chat from './pages/Chat.svelte'
  import Mailbox from './pages/Mailbox.svelte'
  import Config from './pages/Config.svelte'
  import ProvidersList from './pages/providers/ProvidersList.svelte'
  import ProviderForm from './pages/providers/ProviderForm.svelte'
  import ProviderModelForm from './pages/providers/ProviderModelForm.svelte'
  import PresetForm from './pages/PresetForm.svelte'

  let {
    store,
    themeMode,
    onThemeMode,
    onSwitchBackend,
    onBackendSwitched,
    onUiLocale,
    onAddUser,
  }: Omit<PageProps, 'showBack' | 'initialId' | 'overlay' | 'modelId'> = $props()

  let width = $state(typeof window !== 'undefined' ? window.innerWidth : 1280)
  $effect(() => {
    const on = () => (width = window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  })

  const isCompact = $derived(width < 640)
  const hideBottomBar = $derived(isCompact && store.siderTab === 'chat' && store.activeSessionId != null)

  const tabs = [
    { id: 'chat' as const, label: 'tabChat' },
    { id: 'config' as const, label: 'tabConfig' },
  ]

  function componentFor(page: AppPage): Component<PageProps> {
    switch (page.kind) {
      case 'chat_list':
        return SessionList as Component<PageProps>
      case 'chat_session':
        return Chat as Component<PageProps>
      case 'chat_overlay':
        return Mailbox as Component<PageProps>
      case 'config_root':
      case 'config_sub':
        return Config as Component<PageProps>
      case 'providers_list':
        return ProvidersList as Component<PageProps>
      case 'provider_form':
        return ProviderForm as Component<PageProps>
      case 'provider_models':
        return ProviderModelForm as Component<PageProps>
      case 'preset_form':
        return PresetForm as Component<PageProps>
    }
  }

  // The last N pages of the current tab's stack (oldest → newest).
  const panes = $derived.by(() => {
    const stack = store.currentStack
    const n = isCompact ? 1 : 2
    const start = Math.max(0, Math.min(stack.length - n, stack.length - 1))
    return stack
      .slice(start)
      .map((page, i, arr) => ({
        page,
        isTop: i === arr.length - 1,
        C: componentFor(page),
      }))
  })
</script>

<div class="flex h-dvh w-full flex-col overflow-hidden bg-background sm:flex-row">
  {#if !isCompact}
    <nav class="flex w-24 shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-3">
      {#each tabs as tb (tb.id)}
        <button
          type="button"
          class={cn(
            'flex w-16 flex-col items-center gap-1 rounded-lg py-2.5',
            store.siderTab === tb.id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted',
          )}
          onclick={() => store.switchTab(tb.id)}
        >
          {#if tb.id === 'chat'}<AppIcons.chat class="size-[22px]" />{:else}<AppIcons.settings class="size-[22px]" />{/if}
          <span class="text-micro">{t(tb.label)}</span>
        </button>
      {/each}
    </nav>
  {/if}

  <main class={cn('flex min-h-0 min-w-0 flex-1', isCompact && !hideBottomBar && 'pb-[60px]')}>
    {#each panes as p, i (p.page.key)}
      <div class="flex min-h-0 min-w-0 flex-1 {i > 0 ? 'border-l border-border' : ''}">
        <p.C
          {store}
          {themeMode}
          {onThemeMode}
          {onSwitchBackend}
          {onBackendSwitched}
          {onUiLocale}
          {onAddUser}
          showBack={p.isTop}
          initialId={p.page.kind === 'config_sub' ? p.page.id : undefined}
          overlay={p.page.kind === 'chat_overlay' ? p.page.overlay : undefined}
          modelId={p.page.kind === 'provider_models' ? p.page.modelId : undefined}
        />
      </div>
    {/each}
  </main>

  {#if isCompact && !hideBottomBar}
    <nav class="fixed inset-x-0 bottom-0 z-30 flex h-[60px] border-t border-border bg-card">
      {#each tabs as tb (tb.id)}
        <button
          type="button"
          class={cn(
            'flex flex-1 flex-col items-center justify-center gap-1',
            store.siderTab === tb.id ? 'text-primary' : 'text-muted-foreground',
          )}
          onclick={() => store.switchTab(tb.id)}
        >
          {#if tb.id === 'chat'}<AppIcons.chat class="size-[22px]" />{:else}<AppIcons.settings class="size-[22px]" />{/if}
          <span class="text-micro">{t(tb.label)}</span>
        </button>
      {/each}
    </nav>
  {/if}
</div>
