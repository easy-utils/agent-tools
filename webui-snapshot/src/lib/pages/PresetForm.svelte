<script lang="ts">
  // PresetForm — web port of flutter screens/preset_form.dart: full-page
  // editor for a NEW user preset (name + system prompt + max turns + tool
  // whitelist chips).
  import type { PageProps } from '$lib/page-props'
  import type { ToolInfo } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import { Prefs } from '$lib/prefs'
  import { getLocale } from '$lib/i18n.svelte'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { cn } from '$lib/utils'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'

  let { store, showBack = false }: PageProps = $props()

  let id = $state('')
  let sysPrompt = $state('')
  let maxTurns = $state('25')
  let selectedTools = $state<Set<string>>(new Set())
  let tools = $state<ToolInfo[]>([])
  let saving = $state(false)

  const canSave = $derived(id.trim() !== '' && !saving)

  $effect(() => {
    void (async () => {
      try {
        tools = await store.api.tools(Prefs.effectiveAgentLocale(getLocale() === 'zh'))
      } catch (e) {
        showErrorToast(t('loadError', { e: String(e) }))
      }
    })()
  })

  function toggleTool(name: string) {
    const next = new Set(selectedTools)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    selectedTools = next
  }

  async function save() {
    if (!canSave) return
    saving = true
    try {
      await store.api.savePreset({
        id: id.trim(),
        systemPrompt: sysPrompt,
        systemPromptI18n: {},
        tools: [...selectedTools],
        maxTurns: parseInt(maxTurns) || 25,
        isSystem: false,
      })
      showToast(t('saved'))
      store.popPage()
    } catch (e) {
      showErrorToast(String(e))
    }
    saving = false
  }
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader title={t('newPreset')} onBack={showBack ? () => store.popPage() : null}>
    <button type="button" class="ml-auto text-sm text-primary disabled:opacity-40" disabled={!canSave} onclick={() => void save()}>{t('save')}</button>
  </PageHeader>

  <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
    <label class="block">
      <span class="mb-1 block text-meta text-muted-foreground">{t('presetId')}</span>
      <Input bind:value={id} />
    </label>
    <label class="block">
      <span class="mb-1 block text-meta text-muted-foreground">{t('systemPrompt')}</span>
      <Textarea bind:value={sysPrompt} rows={4} />
    </label>
    <label class="block">
      <span class="mb-1 block text-meta text-muted-foreground">{t('maxTurns')}</span>
      <Input bind:value={maxTurns} type="number" min="1" />
    </label>

    <div>
      <div class="mb-2 text-meta font-semibold">{t('tools')} · {selectedTools.size}</div>
      <div class="flex flex-wrap gap-1.5">
        {#each tools as tl (tl.name)}
          <button
            type="button"
            class={cn(
              'rounded-full border px-2.5 py-1 text-micro',
              selectedTools.has(tl.name)
                ? 'border-primary/50 bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted',
            )}
            onclick={() => toggleTool(tl.name)}
          >{tl.name}</button>
        {/each}
      </div>
    </div>

    <div class="flex justify-end">
      <button
        type="button"
        class="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/80 disabled:opacity-40"
        disabled={!canSave}
        onclick={() => void save()}
      >{t('create')}</button>
    </div>
  </div>
</div>
