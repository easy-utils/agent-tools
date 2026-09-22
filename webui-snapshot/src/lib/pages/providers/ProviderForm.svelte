<script lang="ts">
  import { AppIcons } from '$lib/icons'
  // ProviderForm — web port of flutter ProviderFormScreen: edit/create a TEXT
  // provider (template picker from models.dev, id/apiType/baseUrl/key, model
  // rows with the model drill-in form).
  import type { PageProps } from '$lib/page-props'
  import { t } from '$lib/i18n.svelte'
  import { showToast, showErrorToast } from '$lib/toast.svelte'
  import { loadModelsDev, npmToType, type MdProvider } from '$lib/modelsdev'
  import { Select } from '$lib/components/ui/select'
  import { Input } from '$lib/components/ui/input'
  import CapabilityIcon from './CapabilityIcon.svelte'
  import { apiTypeLabelKey, apiTypesForCapability, capabilityLabelKey } from './common'
  import ModelRow from './ModelRow.svelte'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'

  let { store, showBack = false }: PageProps = $props()

  const draft = $derived(store.providerDraft)
  let id = $state('')
  let url = $state('')
  let key = $state('')
  let apiType = $state<string>('openai-compatible')
  let registering = $state(false)
  let templateOpen = $state(false)
  let templates = $state<MdProvider[]>([])
  let templateQuery = $state('')

  $effect(() => {
    // Refresh the capability matrix on open (falls back to the bundled copy).
    void store.refreshProviderCatalog()
  })

  $effect(() => {
    const d = store.providerDraft
    if (d) {
      id = d.id
      url = d.baseUrl
      key = d.apiKey
      apiType = d.apiType
    }
  })

  const canSave = $derived(id.trim() !== '' && url.trim() !== '' && !registering)

  async function openTemplates() {
    templateOpen = true
    templateQuery = ''
    if (!templates.length) {
      try {
        templates = await loadModelsDev()
      } catch (e) {
        templateOpen = false
        showErrorToast(String(e))
      }
    }
  }

  const filteredTemplates = $derived.by(() => {
    if (!templateQuery.trim()) return templates
    const needle = templateQuery.trim().toLowerCase()
    return templates.filter(
      p =>
        p.name.toLowerCase().includes(needle) ||
        p.npm.toLowerCase().includes(needle) ||
        p.models.some(m => m.id.toLowerCase().includes(needle)),
    )
  })

  function pickTemplate(p: MdProvider) {
    const d = store.providerDraft
    if (!d) return
    templateOpen = false
    const isText = d.capability === 'text'
    d.id = p.name.toLowerCase().replace(/\s+/g, '-')
    d.baseUrl = url
    d.apiType = npmToType(p.npm)
    // A non-text provider has no chat models: the catalog's context limits
    // only apply to the text modality.
    d.models = p.models
      .filter(m => m.attachment !== true || true)
      .map(m => ({
        id: m.id,
        name: m.name,
        contextLimit: isText ? (m.contextLimit ?? 0) : 0,
        modelType: isText ? 'text' : d.capability,
      }))
    id = d.id
    apiType = d.apiType
    if (!url && p.description) url = ''
  }

  const availableApiTypes = $derived(
    apiTypesForCapability(store.providerCatalog, draft?.capability ?? 'text'),
  )

  function removeModel(mid: string) {
    const d = store.providerDraft
    if (!d) return
    d.models = d.models.filter(m => m.id !== mid)
  }

  async function save() {
    const d = store.providerDraft
    if (!d) return
    d.id = id.trim()
    d.apiType = apiType
    d.baseUrl = url.trim()
    d.apiKey = key
    if (!d.id || !d.baseUrl) return
    // Context limit is required (> 0) for TEXT providers only.
    if (d.capability === 'text' && d.models.some(m => (m.contextLimit ?? 0) <= 0)) {
      showToast(t('contextLengthRequired'))
      return
    }
    registering = true
    try {
      await store.api.registerProvider({
        providerId: d.id,
        capability: d.capability,
        apiType: d.apiType,
        baseUrl: d.baseUrl,
        apiKey: d.apiKey,
        models: d.models,
      })
      store.bumpProvidersRevision()
      store.endProviderDraft()
      showToast(t('saved'))
      store.popPage()
    } catch (e) {
      showErrorToast(String(e))
    }
    registering = false
  }
</script>

{#if !draft}
  <div class="flex h-full items-center justify-center">
    <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
  </div>
{:else}
  <div class="flex h-full w-full flex-col">
    <PageHeader
      title={draft.originalId ? t('settingsTitle') : t('addProvider')}
      onBack={showBack
        ? () => {
            store.endProviderDraft()
            store.popPage()
          }
        : null}
    />

    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      <button
        type="button"
        class="flex h-10 w-full items-center gap-2 rounded-md border border-input px-3 text-left hover:bg-muted"
        onclick={() => void openTemplates()}
      >
        <AppIcons.sparkles class="size-4 text-primary" />
        <span class="truncate text-meta text-muted-foreground">{t('providerTemplateHint')}</span>
      </button>

      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('providerIdReq')}</span>
        <Input bind:value={id} disabled={!!draft.originalId} />
      </label>

      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('apiType')}</span>
        <Select bind:value={apiType} items={availableApiTypes.map(ty => ({ value: ty, label: t(apiTypeLabelKey(ty)) }))} />
      </label>

      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('baseUrlReq')}</span>
        <Input bind:value={url} />
      </label>

      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('apiKeyReq')}</span>
        <Input bind:value={key} type="password" />
      </label>

      <div class="flex items-center pt-2">
        <span class="flex-1 text-meta font-semibold">{t('modelsLabel')}</span>
        <button
          type="button"
          class="rounded p-1.5 text-primary hover:bg-muted"
          title={t('addModel')}
          onclick={() => store.pushPage({ kind: 'provider_models', key: 'provider_model_new', modelId: null })}
        ><AppIcons.add class="size-4" /></button>
      </div>
      {#if draft.models.length === 0}
        <p class="py-1 text-micro text-muted-foreground">{t('providerTemplateHint')}</p>
      {/if}
      {#each draft.models as m (m.id)}
        <ModelRow
          model={m}
          onTap={() => store.pushPage({ kind: 'provider_models', key: `provider_model_${m.id}`, modelId: m.id })}
          onRemove={() => removeModel(m.id)}
        />
      {/each}
    </div>

    <div class="border-t border-border p-3">
      <button
        type="button"
        class="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-40"
        disabled={!canSave}
        onclick={() => void save()}
      >
        {registering ? t('registering') : draft.originalId ? t('save') : t('register')}
      </button>
    </div>
  </div>
{/if}

{#if templateOpen}
  <div class="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="presentation" onclick={() => (templateOpen = false)}>
    <div class="flex h-[70vh] w-[min(92vw,520px)] flex-col rounded-lg border border-border bg-card shadow-xl" onclick={e => e.stopPropagation()} role="presentation">
      <div class="border-b border-border p-3">
        <Input bind:value={templateQuery} placeholder={t('search')} />
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        {#each filteredTemplates as p (p.npm)}
          <button type="button" class="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted" onclick={() => pickTemplate(p)}>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-body">{p.name}</span>
              <span class="block truncate text-micro text-muted-foreground">{p.npm} · {p.models.length}</span>
            </span>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}
