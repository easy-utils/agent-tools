<script lang="ts">
  // ProviderModelForm — web port of flutter ProviderModelScreen: a SINGLE text
  // model entry (id, name, REQUIRED context) with a live Test button; writes
  // into the shared provider draft.
  import type { PageProps } from '$lib/page-props'
  import { t } from '$lib/i18n.svelte'
  import { showToast, showErrorToast } from '$lib/toast.svelte'
  import { loadModelsDev } from '$lib/modelsdev'
  import { capabilityLabelKey } from './common'
  import { AppIcons } from '$lib/icons'
  import CapabilityIcon from './CapabilityIcon.svelte'

  let { store, showBack = false, modelId = null }: PageProps & { modelId?: string | null } = $props()

  const draft = $derived(store.providerDraft)
  const existing = $derived(draft?.models.find(m => m.id === modelId) ?? null)
  const isEdit = $derived(modelId != null)

  let mid = $state('')
  let name = $state('')
  let ctx = $state('')
  // The model's modality IS the draft provider's (semantic grouping): it is
  // read-only here.
  const capability = $derived(store.providerDraft?.capability ?? 'text')
  let testing = $state(false)
  let testOk = $state<boolean | null>(null)
  let testMsg = $state('')

  $effect(() => {
    mid = existing?.id ?? ''
    name = existing?.name ?? ''
    ctx = existing && (existing.contextLimit ?? 0) > 0 ? String(existing.contextLimit) : ''
  })

  const canSave = $derived(mid.trim() !== '')

  function save() {
    const d = store.providerDraft
    if (!d) return
    const id = mid.trim()
    if (!id) return
    // context_limit is required (> 0) for TEXT models only.
    const c = capability === 'text' ? parseInt(ctx.trim()) : 0
    if (capability === 'text' && (!c || c <= 0)) {
      showToast(t('contextLengthRequired'))
      return
    }
    if (isEdit) d.models = d.models.filter(m => m.id !== modelId)
    d.models = d.models.filter(m => m.id !== id)
    d.models = [
      ...d.models,
      { id, name: name.trim() || id, contextLimit: c, modelType: capability },
    ]
    store.popPage()
  }

  async function test() {
    const d = store.providerDraft
    if (!d || !mid.trim()) return
    testing = true
    testOk = null
    testMsg = ''
    try {
      const r = await store.api.testProvider({
        apiType: d.apiType,
        baseUrl: d.baseUrl,
        apiKey: d.apiKey,
        providerId: d.id,
        model: `${d.id}/${mid.trim()}`,
        capability,
      })
      testOk = r.ok
      testMsg = r.ok ? t('testModelOk', { r: String(r.result ?? '') }) : String(r.result ?? t('testFailed'))
    } catch (e) {
      testOk = false
      testMsg = String(e)
    }
    testing = false
  }

  async function autofill() {
    try {
      const provs = await loadModelsDev()
      const q = mid.trim().toLowerCase()
      for (const p of provs) {
        const m = p.models.find(x => x.id.toLowerCase() === q)
        if (m) {
          if (!name) name = m.name
          if (!ctx && m.contextLimit) ctx = String(m.contextLimit)
          showToast(t('saved'))
          return
        }
      }
      showErrorToast(t('notFound'))
    } catch (e) {
      showErrorToast(String(e))
    }
  }
</script>

{#if !draft}
  <div class="flex h-full items-center justify-center">
    <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
  </div>
{:else}
  <div class="flex h-full w-full flex-col">
    <header class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
      {#if showBack}
        <button type="button" class="rounded p-1.5 hover:bg-muted" onclick={() => store.popPage()}><AppIcons.back class="size-[18px]" /></button>
      {/if}
      <span class="text-sm font-semibold">{isEdit ? t('editModel') : t('addModel')}</span>
      <button type="button" class="ml-auto text-sm text-primary disabled:opacity-40" disabled={!canSave} onclick={save}>{t('save')}</button>
    </header>

    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      <label class="block">
        <span class="mb-1 flex items-center justify-between text-meta text-muted-foreground">
          <span>{t('modelIdReq')}</span>
          <button type="button" class="text-primary underline" onclick={() => void autofill()}>{t('autofill')}</button>
        </span>
        <input bind:value={mid} class="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono text-sm outline-none focus-visible:border-ring" />
      </label>

      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('modelName')}</span>
        <input bind:value={name} class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring" />
      </label>

      <div class="flex items-center gap-2 rounded-md border border-input px-3 py-2.5">
        <CapabilityIcon {capability} size={18} />
        <span class="text-meta text-muted-foreground">{t(capabilityLabelKey(capability))}</span>
      </div>

      {#if capability === 'text'}
        <label class="block">
          <span class="mb-1 block text-meta text-muted-foreground">{t('contextLengthLabel')}</span>
          <input bind:value={ctx} type="number" min="1" class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring" />
          <span class="mt-1 block text-micro text-muted-foreground">{t('contextOptional')}</span>
        </label>
      {:else}
        <p class="text-micro text-muted-foreground">{t('nonTextModelHint')}</p>
      {/if}

      <div class="pt-2">
        <button
          type="button"
          class="rounded-md border border-border px-3 py-1.5 text-meta hover:bg-muted disabled:opacity-40"
          disabled={testing || !mid.trim()}
          onclick={() => void test()}
        ><AppIcons.flask class="mr-1 inline size-3.5" />{testing ? t('connecting') : t('test')}</button>
        {#if testOk !== null}
          <div class="mt-2 rounded-md border {testOk ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'} px-3 py-2 text-micro">
            {testMsg}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
