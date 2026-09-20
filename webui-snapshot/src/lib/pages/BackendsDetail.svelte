<script lang="ts">
  import { AppIcons } from '$lib/icons'
  // BackendsDetail — web port of flutter config.dart _BackendsDetail: the
  // saved-connections manager (switch / delete / add).
  import type { AppStore } from '$lib/store.svelte'
  import type { BackendCfg } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import { Prefs } from '$lib/prefs'
  import { showToast } from '$lib/toast.svelte'
  import { Button } from '$lib/components/ui/button'

  let {
    store,
    onBackendSwitched,
    onAddUser,
  }: {
    store: AppStore
    onBackendSwitched?: ((b: BackendCfg) => void) | null
    onAddUser?: (() => void) | null
  } = $props()

  let backends = $state<BackendCfg[]>([])
  // A backend is identified by its TOKEN (multiple users may share one
  // same-origin base URL), so the active-row check must be token-based too.
  let activeToken = $derived(store.api.token)

  $effect(() => {
    backends = Prefs.backends()
  })

  async function remove(b: BackendCfg) {
    Prefs.removeBackend(b)
    backends = Prefs.backends()
    showToast(t('saved'))
  }
</script>

<div class="h-full w-full p-4">
  {#if backends.length === 0}
    <p class="py-2 text-meta text-muted-foreground">{t('noSavedBackends')}</p>
  {/if}
  <div class="space-y-2">
    {#each backends as b (b.token)}
      <div class="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
        {#if activeToken === b.token}<AppIcons.target class="size-4 shrink-0 text-primary" />{:else}<AppIcons.server class="size-4 shrink-0 text-muted-foreground" />{/if}
        <span class="min-w-0 flex-1">
          <span class="block truncate text-body">{b.username || b.name || t('tokenLabel')}</span>
        </span>
        <button type="button" class="rounded p-1.5 text-muted-foreground hover:bg-muted" title={t('deleteBackend')} onclick={() => void remove(b)}><AppIcons.delete class="size-4" /></button>
        <Button size="sm" variant="outline" disabled={activeToken === b.token} onclick={() => onBackendSwitched?.(b)}>
          {activeToken === b.token ? t('connected') : t('connect')}
        </Button>
      </div>
    {/each}
  </div>

  <!-- Add another user: clears the active connection and returns to the setup
       form (mirrors Flutter's addBackend entry). -->
  <div class="mt-4 border-t border-border pt-2">
    <button
      type="button"
      class="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-muted"
      onclick={() => onAddUser?.()}
    >
      <AppIcons.add class="size-[18px] shrink-0 text-primary" />
      <span class="min-w-0 flex-1">
        <span class="block text-body">{t('addBackend')}</span>
        <span class="block truncate text-micro text-muted-foreground">{t('addBackendHint')}</span>
      </span>
    </button>
  </div>
</div>
