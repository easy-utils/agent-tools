<script lang="ts">
  import { AppIcons } from '$lib/icons'
  // ProvidersList — web port of flutter ProvidersListScreen: the two sections
  // (every provider including gateways), default-model
  // pick (sets `default_model` config), add/edit entry points.
  import type { PageProps } from '$lib/page-props'
  import type { ProviderInfo } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast } from '$lib/toast.svelte'
  import CapabilityIcon from './CapabilityIcon.svelte'
  import { MODEL_CAPABILITIES, apiTypeLabelKey, capabilityLabelKey } from './common'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'
  import SectionLabel from '$lib/components/layout/SectionLabel.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'

  let { store, showBack = false }: PageProps = $props()

  const providers = $state<Record<string, ProviderInfo>>({})
  let loading = $state(true)
  let defaultModel = $state('')
  let pickOpen = $state(false)
  let seenRevision = 0

  $effect(() => {
    void load()
  })

  // reload when a provider was registered/removed
  $effect(() => {
    if (store.providersRevision !== seenRevision) {
      seenRevision = store.providersRevision
      void reload()
    }
  })

  async function reload() {
    try {
      Object.keys(providers).forEach(k => delete providers[k])
      const p = await store.api.providers()
      for (const [k, v] of Object.entries(p)) providers[k] = v
    } catch (e) {
      showErrorToast(t('loadError', { e: String(e) }))
    }
  }

  async function load() {
    try {
      defaultModel = await store.api.config('default_model')
    } catch {
      /* unset */
    }
    await reload()
    loading = false
  }

  const allProviders = $derived(
    Object.values(providers).sort((a, b) => (a.providerId < b.providerId ? -1 : 1)),
  )

  const defaultRefs = $derived.by(() => {
    const refs: string[] = []
    for (const p of allProviders) {
      if (p.capability !== 'text') continue
      for (const m of p.models) {
        if ((m.contextLimit ?? 0) > 0) refs.push(`${p.providerId}/${m.id}`)
      }
    }
    refs.sort()
    if (defaultModel && !refs.includes(defaultModel)) refs.unshift(defaultModel)
    return refs
  })

  async function pickDefault(ref: string) {
    pickOpen = false
    if (ref === defaultModel) return
    try {
      await store.api.setConfigKey('default_model', ref)
      defaultModel = ref
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  function add(capability: string) {
    store.beginProviderDraft(null, capability)
    store.pushPage({ kind: 'provider_form', key: 'provider_form' })
  }

  function edit(p: ProviderInfo) {
    store.beginProviderDraft(p)
    store.pushPage({ kind: 'provider_form', key: 'provider_form' })
  }

  function byCapability(capability: string): ProviderInfo[] {
    return allProviders.filter(p => p.capability === capability)
  }

  function capabilityLabel(capability: string): string {
    return t(capabilityLabelKey(capability))
  }

  function apiTypeLabel(apiType: string): string {
    const key = apiTypeLabelKey(apiType)
    return key ? t(key) : apiType
  }
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader title={t('llmProviders')} onBack={showBack ? () => store.popPage() : null} />

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if loading}
      <div class="flex justify-center py-8">
        <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
      </div>
    {:else}
      {#if allProviders.length === 0}
        <EmptyState>{t('noProviders')}</EmptyState>
      {/if}
      <!-- ONE SECTION PER MODALITY (semantic grouping). Only TEXT carries the
           tenant default model. -->
      {#each MODEL_CAPABILITIES as cap (cap)}
        <div class="flex items-center pr-2">
          <SectionLabel class="min-w-0 flex-1">{capabilityLabel(cap)}</SectionLabel>
          <IconButton icon={AppIcons.add} label={t('addProvider')} variant="primary" class="p-1" onclick={() => add(cap)} />
        </div>

        {#if cap === 'text'}
          <!-- default model tile -->
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted"
            onclick={() => (pickOpen = true)}
          >
            <AppIcons.star class="size-5 shrink-0 text-primary" />
            <span class="min-w-0 flex-1">
              <span class="block text-body font-medium">{t('defaultModel')}</span>
              <span class="block truncate text-micro text-muted-foreground">{defaultModel || t('none')}</span>
            </span>
            <AppIcons.chevron_right class="size-4 text-muted-foreground" />
          </button>
        {/if}

        {#each byCapability(cap) as p (p.providerId)}
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted"
            onclick={() => edit(p)}
          >
            <CapabilityIcon capability={p.capability} size={20} />
            <span class="min-w-0 flex-1">
              <span class="block text-body font-medium">{p.providerId}</span>
              <span class="block truncate text-micro text-muted-foreground">{apiTypeLabel(p.apiType)} · {t('modelsCount', { n: p.models.length })}</span>
            </span>
            <AppIcons.chevron_right class="size-4 text-muted-foreground" />
          </button>
        {/each}
      {/each}
    {/if}
  </div>
</div>

{#if pickOpen}
  <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="presentation" onclick={() => (pickOpen = false)}>
    <div class="max-h-[70vh] w-[min(92vw,420px)] overflow-y-auto rounded-lg border border-border bg-card p-2 shadow-xl" onclick={e => e.stopPropagation()} role="presentation">
      <div class="px-3 py-2 text-sm font-semibold">{t('defaultModel')}</div>
      {#each ['', ...defaultRefs] as ref (ref)}
        <button
          type="button"
          class="flex w-full items-center gap-3 px-3 py-2.5 text-left text-meta hover:bg-muted"
          onclick={() => void pickDefault(ref)}
        >
          {#if ref === defaultModel}<AppIcons.target class="size-4 text-primary" />{:else}<AppIcons.circle class="size-4 text-muted-foreground" />{/if}
          <span class="font-mono">{ref || t('none')}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}
