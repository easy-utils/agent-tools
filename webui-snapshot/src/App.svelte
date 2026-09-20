<script lang="ts">
  // App root — web port of flutter main.dart: prefs bootstrap (?base=&token=
  // seeding), the Setup gate (verified connect), the backends manager page and
  // the responsive two-tab shell.
  import { onMount } from 'svelte'
  import { AgentApi } from './lib/api'
  import { getLocale, setLocale, systemLocale, t } from './lib/i18n.svelte'
  import { Prefs, type ThemeMode } from './lib/prefs'
  import { openLocalStore } from './lib/db'
  import { scopeOf } from './lib/scope'
  import type { LocalStore } from './lib/db'
  import { AppStore } from './lib/store.svelte'
  import { showErrorToast } from './lib/toast.svelte'
  import { setAuthExpiredHandler } from './lib/events'
  import { confirmDialog } from './lib/dialogs'
  import type { BackendCfg } from './lib/models'
  import { backendNameFor } from './lib/models'
  import Shell from './lib/Shell.svelte'
  import Overlays from './lib/components/Overlays.svelte'
  import FileViewer from './lib/components/FileViewer.svelte'
  import LoadingScreen from './lib/components/LoadingScreen.svelte'
  import { Button } from './lib/components/ui/button'
  import { Input } from './lib/components/ui/input'
  import { AppIcons } from '$lib/icons'

  type Phase = 'loading' | 'setup' | 'backends' | 'app'

  let phase = $state<Phase>('loading')
  let baseUrl = $state('')
  let token = $state('')
  // Theme: tri-state pref (system | light | dark), DEFAULT follow-system —
  // "system" resolves live against the OS prefers-color-scheme query.
  let themeMode = $state<ThemeMode>('system')
  let systemDark = $state(false)
  const dark = $derived(themeMode === 'dark' || (themeMode === 'system' && systemDark))
  let store = $state<AppStore | null>(null)
  let local: LocalStore | null = null

  // setup form
  let setupToken = $state('')
  let showToken = $state(false)
  let busy = $state(false)

  // backends page
  let backends = $state<BackendCfg[]>([])

  // UI language: an explicit zh/en pref, or follow the system language (the
  // four-client default). zh for any Chinese system locale, en otherwise.
  const savedLocalePref = localStorage.getItem('agent.uiLocale')
  setLocale(
    savedLocalePref === 'zh' || savedLocalePref === 'en' ? savedLocalePref : systemLocale(),
  )

  // Apply the resolved theme to <html> (the CSS custom properties flip on it).
  $effect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  })

  function applyThemeMode(m: ThemeMode) {
    themeMode = m
    Prefs.saveThemeMode(m)
  }

  function setUiLocale(l: 'system' | 'zh' | 'en') {
    localStorage.setItem('agent.uiLocale', l)
    setLocale(l === 'system' ? systemLocale() : l)
    // A session whose locale is "follow" inherits the tenant config locale, so
    // keep that in sync with the effective agent locale whenever the UI
    // language changes (otherwise the agent keeps answering in the stale one).
    void syncAgentLocale()
  }

  /** Push the effective agent locale (UI language when the pref is "follow")
   *  to the tenant config KV, so a session's "follow" actually follows it. */
  async function syncAgentLocale() {
    if (!store) return
    try {
      await store.api.setConfigKey(
        'locale',
        Prefs.effectiveAgentLocale(getLocale() === 'zh'),
      )
    } catch {
      /* best-effort */
    }
  }

  // 401/403 anywhere → one-tap "sign in again" (flutter auth_gate.dart).
  setAuthExpiredHandler(async () => {
    if (phase !== 'app') return
    const ok = await confirmDialog({
      title: t('authExpiredTitle'),
      body: t('authExpiredBody'),
      confirmLabel: t('signInAgain'),
      destructive: true,
    })
    if (ok) logout()
  })

  onMount(() => {
    themeMode = Prefs.loadThemeMode()
    // Live system-theme tracking for the "follow system" mode.
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    systemDark = mq?.matches ?? false
    mq?.addEventListener('change', e => (systemDark = e.matches))
    void boot()
  })

  // ---- browser Back / swipe-back drives the in-app navigation stack ----
  // Every in-app "forward" navigation pushes a history entry; a popstate pops
  // one in-app page and re-arms a sentinel entry so the NEXT back still has
  // something to consume. Without this, the phone's edge-swipe / back button
  // did nothing (or left the SPA), so no page obeyed the system gesture.
  let navDepth = 0

  function inAppDepth(): number {
    if (!store || phase !== 'app') return 0
    return store.currentStack.length - 1
  }

  if (typeof window !== 'undefined') {
    window.history.replaceState({ agentNav: 0 }, '')
    window.addEventListener('popstate', () => {
      if (phase !== 'app' || !store) return
      if (store.currentStack.length > 1) {
        // Consume the back as one in-app pop … (pushState below does NOT fire
        // popstate, so this never recurses).
        store.popPage()
        navDepth = inAppDepth()
        window.history.pushState({ agentNav: navDepth + 1 }, '')
        navDepth += 1
      }
    })
  }

  // Mirror in-app pushes into history so Back/swipe has depth to consume.
  $effect(() => {
    const target = inAppDepth()
    for (let i = navDepth; i < target; i++) {
      window.history.pushState({ agentNav: i + 1 }, '')
    }
    if (target > navDepth) navDepth = target
  })

  // The webui is served SAME-ORIGIN with the agent: the aggregating proxy in
  // front forwards `/agent.v1.*` to the agent, so the API base is always this
  // page's own origin. No domain is ever entered — a user supplies only a
  // tenant token. `?base=` still overrides for local dev.
  const SAME_ORIGIN_BASE = typeof location !== 'undefined' ? location.origin : ''

  async function boot() {
    // A saved token (or an explicit ?base=&token= link, dev only) goes straight
    // in; otherwise the user lands on the connection form — an install must
    // never silently sign in with a baked-in account.
    const prefs = Prefs.load()
    let base = prefs.baseUrl ?? ''
    let tok = prefs.token ?? ''
    const qp = new URLSearchParams(location.search)
    if (qp.get('base')) base = qp.get('base')!
    if (qp.get('token')) tok = qp.get('token')!
    // Default to same-origin; only an explicit ?base= can point elsewhere.
    if (!base) base = SAME_ORIGIN_BASE
    if (!tok) {
      setupToken = ''
      baseUrl = base
      token = tok
      phase = 'setup'
      return
    }
    if (base !== prefs.baseUrl || tok !== prefs.token) Prefs.save(base, tok)
    baseUrl = base
    token = tok
    await enterApp()
  }

  async function buildStore(): Promise<AppStore> {
    const api = await AgentApi.create(baseUrl, token)
    try {
      local = await openLocalStore(scopeOf(baseUrl, token))
    } catch {
      local = null
    }
    return new AppStore(api, local)
  }

  async function enterApp() {
    phase = 'loading'
    try {
      store = await buildStore()
      phase = 'app'
      // Backfill the username for entries saved before GetIdentity existed
      // (best-effort, after the app is usable).
      void refreshIdentity()
      // Keep the tenant config locale aligned with the effective agent locale
      // (UI language when the pref is "follow") so a session that follows it
      // resolves correctly.
      void syncAgentLocale()
    } catch (e) {
      showErrorToast(String(e))
      phase = 'setup'
    }
  }

  /** Re-resolve the active token's username and update the saved entry. */
  async function refreshIdentity() {
    if (!store) return
    try {
      const username = (await store.api.identity()).tenantName
      if (!username) return
      Prefs.upsertBackend({
        name: username,
        username,
        baseUrl: SAME_ORIGIN_BASE,
        token,
      })
      backends = Prefs.backends()
    } catch {
      /* identity optional */
    }
  }

  async function connect() {
    const base = SAME_ORIGIN_BASE
    const tok = setupToken.trim()
    if (!tok || busy) return
    busy = true
    try {
      const api = await AgentApi.create(base, tok)
      await api.listSessions() // verify before saving
      // Resolve the human username from the token (best-effort: never block
      // sign-in on it).
      let username = ''
      try {
        username = (await api.identity()).tenantName
      } catch {
        /* identity optional */
      }
      Prefs.save(base, tok)
      Prefs.upsertBackend({ name: username || backendNameFor(base), username, baseUrl: base, token: tok })
      baseUrl = base
      token = tok
      await enterApp()
    } catch (e) {
      showErrorToast(t('loadError', { e: String(e) }))
    }
    busy = false
  }

  function openBackends() {
    backends = Prefs.backends()
    phase = 'backends'
  }

  async function switchBackend(b: BackendCfg) {
    const base = SAME_ORIGIN_BASE
    Prefs.save(base, b.token)
    baseUrl = base
    token = b.token
    await enterApp()
    // Refresh the cached username (older entries may predate GetIdentity, or
    // the tenant name may have changed server-side).
    try {
      const username = (await store!.api.identity()).tenantName
      Prefs.upsertBackend({ ...b, name: username || b.name, username })
      backends = Prefs.backends()
    } catch {
      /* identity optional */
    }
  }

  async function deleteBackend(b: BackendCfg) {
    Prefs.removeBackend(b)
    backends = Prefs.backends()
  }

  /** Show only a short, non-reversible tail of a token in the user list. */
  function maskToken(tok: string): string {
    if (tok.length <= 8) return '••••'
    return `••••${tok.slice(-8)}`
  }

  function logout() {
    Prefs.clearActive()
    token = ''
    store = null
    setupToken = ''
    phase = 'setup'
  }

  const canConnect = $derived(setupToken.trim() !== '' && !busy)
</script>

{#if phase === 'app' && store}
  <FileViewer api={store.api} />
  <Shell
    {store}
    {themeMode}
    onThemeMode={applyThemeMode}
    onSwitchBackend={openBackends}
    onBackendSwitched={switchBackend}
    onUiLocale={setUiLocale}
    onAddUser={logout}
  />
{:else if phase === 'backends'}
  <div class="flex h-full flex-col">
    <header class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
      <button type="button" class="rounded p-1.5 hover:bg-muted" onclick={() => phase = token ? 'app' : 'setup'}><AppIcons.back class="size-[18px]" /></button>
      <span class="text-sm font-semibold">{t('backendsTitle')}</span>
    </header>
    <div class="flex-1 overflow-y-auto p-4">
      {#if backends.length === 0}
        <p class="p-2 text-meta text-muted-foreground">{t('noSavedBackends')}</p>
      {/if}
      <div class="space-y-2">
        {#each backends as b (b.token)}
          <div class="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
            {#if b.token === token}<AppIcons.target class="size-4 text-primary" />{:else}<AppIcons.server class="size-4 text-muted-foreground" />{/if}
            <span class="min-w-0 flex-1">
              <span class="block truncate text-body">{b.username || b.name || t('tokenLabel')}</span>
              <span class="block truncate text-micro text-muted-foreground">{maskToken(b.token)}</span>
            </span>
            <button type="button" class="rounded p-1.5 text-muted-foreground hover:bg-muted" title={t('deleteBackend')} onclick={() => void deleteBackend(b)}><AppIcons.delete class="size-4" /></button>
            <Button size="sm" variant="outline" onclick={() => void switchBackend(b)}>{t('connect')}</Button>
          </div>
        {/each}
      </div>
      <div class="mt-4 border-t border-border pt-2">
        <button type="button" class="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left hover:bg-muted" onclick={logout}>
          <AppIcons.add class="size-4" />
          <span class="text-body">{t('addBackend')}</span>
        </button>
      </div>
    </div>
  </div>
{:else if phase === 'setup'}
  <div class="flex h-full items-center justify-center overflow-y-auto p-6">
    <div class="w-full max-w-[480px]">
      <h1 class="mb-6 text-xl font-semibold">{t('appTitle')}</h1>
      <label class="mb-6 block">
        <span class="mb-1.5 block text-meta text-muted-foreground">{t('tokenLabel')}</span>
        <span class="relative block">
          <Input bind:value={setupToken} disabled={busy} type={showToken ? 'text' : 'password'} />
          <button
            type="button"
            class="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
            onclick={() => (showToken = !showToken)}
          >{#if showToken}<AppIcons.eye_off class="size-4" />{:else}<AppIcons.eye class="size-4" />{/if}</button>
        </span>
      </label>
      <Button class="w-full" disabled={!canConnect} onclick={() => void connect()}>
        {busy ? t('connecting') : t('connect')}
      </Button>
      {#if Prefs.backends().length > 0}
        <button
          type="button"
          class="mt-3 w-full rounded-md px-3 py-2 text-meta text-muted-foreground hover:bg-muted"
          onclick={openBackends}
        >{t('backendsTitle')}</button>
      {/if}
    </div>
  </div>
{:else}
  <LoadingScreen />
{/if}

<Overlays />
