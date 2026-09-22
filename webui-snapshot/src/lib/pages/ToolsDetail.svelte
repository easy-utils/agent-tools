<script lang="ts">
  // ToolsDetail — web port of flutter config.dart _ToolsDetail: tools grouped
  // by category, expandable cards, per-knob config fields (text/number/enum/
  // boolean) saved via setExtensionConfig, required-config badges.
  import type { AppStore } from '$lib/store.svelte'
  import type { ProviderInfo, ToolConfig, ToolInfo } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import { Prefs } from '$lib/prefs'
  import { getLocale } from '$lib/i18n.svelte'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { AppIcons } from '$lib/icons'
  import { Select } from '$lib/components/ui/select'
  import { parseToolParams } from '$lib/tool-params'

  let { store }: { store: AppStore } = $props()

  let tools = $state<ToolInfo[]>([])
  let config = $state<Record<string, unknown>>({})
  let providers = $state<Record<string, ProviderInfo>>({})
  let expanded = $state<string | null>(null)
  let loading = $state(true)
  const drafts = $state<Record<string, string>>({})

  $effect(() => {
    void (async () => {
      try {
        tools = await store.api.tools(Prefs.effectiveAgentLocale(getLocale() === 'zh'))
      } catch (e) {
        showErrorToast(t('loadError', { e: String(e) }))
      }
      try {
        config = await store.api.toolConfig()
      } catch {
        /* no config yet */
      }
      try {
        providers = await store.api.providers()
      } catch {
        /* providers optional */
      }
      loading = false
    })()
  })

  const categories = $derived.by(() => {
    const cats: Record<string, ToolInfo[]> = {}
    for (const tl of tools) {
      const k = tl.category || 'other'
      ;(cats[k] ??= []).push(tl)
    }
    return Object.entries(cats)
  })

  function toolConfigValues(name: string): Record<string, unknown> {
    const v = config[name]
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  }

  function requiredMissing(tl: ToolInfo): boolean {
    const vals = toolConfigValues(tl.name)
    return tl.requiredConfig.some(name => {
      const v = vals[name]
      return v == null || String(v) === ''
    })
  }

  /** A knob counts as configured only when its value is non-empty (an
   *  explicitly unset knob is stored as '' and must read as "needs config"). */
  function hasAnyConfig(tl: ToolInfo): boolean {
    const vals = toolConfigValues(tl.name)
    return Object.values(vals).some(v => v != null && String(v) !== '')
  }

  /** Registered models of [capability] as `provider_id/model_id` refs. */
  function modelRefs(capability: string): string[] {
    const out: string[] = []
    for (const p of Object.values(providers)) {
      if (p.capability !== capability) continue
      for (const m of p.models) out.push(`${p.providerId}/${m.id}`)
    }
    return out.sort()
  }

  function knobValue(tl: ToolInfo, knob: ToolConfig): string {
    const k = `${tl.name}.${knob.name}`
    if (k in drafts) return drafts[k]
    const v = toolConfigValues(tl.name)[knob.name]
    return v == null ? '' : String(v)
  }

  async function saveExtConfig(tl: ToolInfo, knob: ToolConfig, value: string) {
    try {
      // Empty means UNSET (there is no delete RPC): the store clears the knob
      // to its declared zero value; the picker then renders 无.
      // The owning EXTENSION id is `tool.category` (e.g. "bundled"); a tool
      // name is NOT an extension (`no manifest for image-generate`).
      await store.api.setToolConfigValue(tl.category, knob.name, value)
      // refresh local view
      const vals = { ...toolConfigValues(tl.name) }
      if (value === '') delete vals[knob.name]
      else vals[knob.name] = value
      config = { ...config, [tl.name]: vals }
      delete drafts[`${tl.name}.${knob.name}`]
      showToast(t('saved'))
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  function fmtDefault(v: unknown): string {
    return v == null ? '' : String(v)
  }
</script>

<div class="h-full w-full p-4">
  {#if loading}
    <div class="flex justify-center py-8">
      <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
    </div>
  {:else if tools.length === 0}
    <p class="py-2 text-center text-meta text-muted-foreground">{t('noTools')}</p>
  {:else}
    {#each categories as [cat, list] (cat)}
      <div class="mt-3 first:mt-0 mb-1 text-micro font-semibold tracking-wider text-muted-foreground uppercase">{cat}</div>
      {#each list as tl (tl.name)}
        {@const knobs = tl.config ?? []}
        {@const vals = toolConfigValues(tl.name)}
        {@const hasConfig = hasAnyConfig(tl)}
        {@const req = requiredMissing(tl)}
        <div class="mb-2 rounded-md border border-border bg-card">
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2.5 text-left"
            onclick={() => (expanded = expanded === tl.name ? null : tl.name)}
          >
            <span class="min-w-0 flex-1 truncate font-mono text-meta">{tl.name}</span>
            {#if knobs.length === 0}
              <span class="text-micro text-muted-foreground">{t('noConfig')}</span>
            {:else}
              <span class="text-micro {req ? 'text-destructive' : hasConfig ? 'text-success' : 'text-warning'}">
                {req ? t('requiredConfig') : hasConfig ? t('configured') : t('needsConfig')}
              </span>
            {/if}
            <span class="text-micro text-muted-foreground">{#if expanded === tl.name}<AppIcons.chevron_down class="size-3" />{:else}<AppIcons.chevron_right class="size-3" />{/if}</span>
          </button>

          {#if expanded === tl.name}
            <div class="space-y-3 border-t border-border/60 px-3 py-3">
              {#if tl.description}
                <p class="text-micro text-muted-foreground">{tl.description}</p>
              {/if}

              {#each knobs as knob (knob.name)}
                <label class="block">
                  <span class="mb-1 flex items-center gap-1.5 text-meta">
                    <span class="font-mono">{knob.name}</span>
                    {#if tl.requiredConfig.includes(knob.name)}
                      <span class="text-destructive">*</span>
                    {/if}
                    {#if knob.description}
                      <span class="text-micro text-muted-foreground">— {knob.description}</span>
                    {/if}
                  </span>
                  {#if knob.kind === 'model'}
                    <!-- Declared model reference: pick from the models
                         registered under the knob's modality. Selecting a
                         value SAVES immediately (webui knob policy). -->
                    <div class="flex gap-2">
                      <Select
                        value={knobValue(tl, knob)}
                        items={[{ value: '', label: t('none') }, ...modelRefs(knob.capability).map(ref => ({ value: ref, label: ref }))]}
                        onchange={v => void saveExtConfig(tl, knob, v)}
                      />
                    </div>
                  {:else if knob.type === 'enum' && knob.enumValues.length}
                    <Select
                      value={knobValue(tl, knob)}
                      items={[{ value: '', label: t('none') }, ...knob.enumValues.map(ev => ({ value: ev, label: ev }))]}
                      onchange={v => void saveExtConfig(tl, knob, v)}
                    />
                  {:else if knob.type === 'boolean'}
                    <Select
                      value={knobValue(tl, knob)}
                      items={[{ value: '', label: t('none') }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }]}
                      onchange={v => void saveExtConfig(tl, knob, v)}
                    />
                  {:else}
                    <div class="flex gap-2">
                      <input
                        type={knob.type === 'number' ? 'number' : 'text'}
                        value={knobValue(tl, knob)}
                        placeholder={fmtDefault(knob.defaultValue)}
                        class="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring"
                        oninput={e => (drafts[`${tl.name}.${knob.name}`] = e.currentTarget.value)}
                        onkeydown={e => e.key === 'Enter' && void saveExtConfig(tl, knob, drafts[`${tl.name}.${knob.name}`] ?? knobValue(tl, knob))}
                      />
                      <button
                        type="button"
                        class="rounded-md border border-border px-3 text-meta hover:bg-muted"
                        onclick={() => void saveExtConfig(tl, knob, drafts[`${tl.name}.${knob.name}`] ?? knobValue(tl, knob))}
                      >{t('save')}</button>
                    </div>
                  {/if}
                </label>
              {/each}

              {#if tl.parameters && Object.keys(tl.parameters).length}
                <div class="rounded-sm border border-border/40 p-2">
                  <div class="mb-1 text-micro font-semibold text-muted-foreground">{t('toolParams')}</div>
                  <div class="space-y-1">
                    {#each parseToolParams(tl.parameters) as p (p.name)}
                      <div class="flex gap-2 text-micro">
                        <span class="font-mono">{p.name}{p.required ? ' *' : ''}</span>
                        <span class="text-muted-foreground">{p.type}</span>
                        {#if p.description}
                          <span class="min-w-0 flex-1 truncate text-muted-foreground">{p.description}</span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/each}
  {/if}
</div>
