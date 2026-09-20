<script lang="ts">
  import { AppIcons } from '$lib/icons'
  // PresetsDetail — web port of flutter config.dart _PresetsDetail: the preset
  // list with default-preset pick, edit dialog and delete.
  import type { AppStore } from '$lib/store.svelte'
  import type { Preset } from '$lib/models'
  import { t, getLocale } from '$lib/i18n.svelte'
  import { Prefs } from '$lib/prefs'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { confirmDialog } from '$lib/dialogs'

  let { store }: { store: AppStore } = $props()

  let presets = $state<Preset[]>([])
  let loading = $state(true)
  let editing = $state<Preset | null>(null)
  let editId = $state('')
  let editPrompt = $state('')
  let editTurns = $state('25')

  const DEFAULT_KEY = 'agent.defaultPreset'
  let defaultPreset = $state(localStorage.getItem(DEFAULT_KEY) || '')

  $effect(() => {
    void load()
  })

  async function load() {
    loading = true
    try {
      // Localize the preset system prompt like ToolsDetail/PresetForm: the
      // server resolves the requested agent locale; without it the panel fell
      // back to the default English prompt.
      presets = await store.api.presets(
        Prefs.effectiveAgentLocale(getLocale() === 'zh'),
      )
    } catch (e) {
      showErrorToast(String(e))
    }
    loading = false
  }

  async function setDefault(p: Preset) {
    defaultPreset = p.id
    localStorage.setItem(DEFAULT_KEY, p.id)
    try {
      await store.api.setConfigKey('default_preset', p.id)
      showToast(t('saved'))
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  function beginEdit(p: Preset) {
    editing = p
    editId = p.id
    editPrompt = p.systemPrompt
    editTurns = String(p.maxTurns)
  }

  async function saveEdit() {
    if (!editing || !editId.trim()) return
    try {
      await store.api.savePreset({
        id: editId.trim(),
        systemPrompt: editPrompt,
        systemPromptI18n: {},
        tools: editing.isSystem ? editing.tools : editing.tools,
        maxTurns: parseInt(editTurns) || 25,
        isSystem: false,
      })
      showToast(t('saved'))
      editing = null
      await load()
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  async function remove(p: Preset) {
    const ok = await confirmDialog({
      title: t('deletePreset'),
      body: p.id,
      confirmLabel: t('delete'),
      destructive: true,
    })
    if (!ok) return
    try {
      await store.api.deletePreset(p.id)
      showToast(t('deleted'))
      await load()
    } catch (e) {
      showErrorToast(String(e))
    }
  }
</script>

<div class="h-full w-full p-4">
  {#if loading}
    <div class="flex justify-center py-8">
      <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
    </div>
  {:else if presets.length === 0}
    <p class="py-2 text-meta text-muted-foreground">{t('noPresets')}</p>
  {:else}
    <div class="space-y-2">
      {#each presets as p (p.id)}
        <div class="rounded-md border border-border bg-card px-3 py-2.5">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class={defaultPreset === p.id ? 'text-primary' : 'text-muted-foreground'}
              title={t('defaultPreset')}
              onclick={() => void setDefault(p)}
            >{#if defaultPreset === p.id}<AppIcons.target class="size-4 text-primary" />{:else}<AppIcons.circle class="size-4 text-muted-foreground" />{/if}</button>
            <span class="min-w-0 flex-1 truncate text-body font-medium">{p.id}</span>
            {#if p.isSystem}
              <span class="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">system</span>
            {/if}
            <button type="button" class="rounded p-1.5 hover:bg-muted" title={t('edit')} onclick={() => beginEdit(p)}><AppIcons.edit class="size-4" /></button>
            {#if !p.isSystem}
              <button type="button" class="rounded p-1.5 text-muted-foreground hover:bg-muted" title={t('delete')} onclick={() => void remove(p)}><AppIcons.delete class="size-4" /></button>
            {/if}
          </div>
          {#if p.systemPrompt}
            <div class="mt-1 line-clamp-2 text-micro text-muted-foreground">{p.systemPrompt}</div>
          {/if}
          <div class="mt-1 flex gap-2 text-micro text-muted-foreground">
            <span>{t('maxTurns')}: {p.maxTurns}</span>
            {#if p.tools.length}
              <span>· {t('tools')}: {p.tools.length}</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if editing}
  <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="presentation" onclick={() => (editing = null)}>
    <div class="w-[min(92vw,520px)] rounded-lg border border-border bg-card p-4 shadow-xl" onclick={e => e.stopPropagation()} role="presentation">
      <div class="mb-3 text-sm font-semibold">{t('editPreset')}</div>
      <label class="mb-3 block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('presetId')}</span>
        <input bind:value={editId} class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring" />
      </label>
      <label class="mb-3 block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('systemPrompt')}</span>
        <textarea bind:value={editPrompt} rows="4" class="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring"></textarea>
      </label>
      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('maxTurns')}</span>
        <input bind:value={editTurns} type="number" min="1" class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring" />
      </label>
      <div class="mt-4 flex justify-end gap-2">
        <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (editing = null)}>{t('cancel')}</button>
        <button type="button" class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80" onclick={() => void saveEdit()}>{t('save')}</button>
      </div>
    </div>
  </div>
{/if}
