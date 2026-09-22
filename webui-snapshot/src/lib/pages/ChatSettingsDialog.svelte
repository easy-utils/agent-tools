<script lang="ts">
  // ChatSettingsDialog — model / variant / preset / locale pickers for the open
  // session. Purely presentational: the parent owns the loads and the save.
  import { t } from '$lib/i18n.svelte'
  import { Select } from '$lib/components/ui/select'
  import { Dialog } from '$lib/components/ui/dialog'
  import type { ModelVariantInfo } from '$lib/models'

  let {
    open = $bindable(false),
    selectedRef = $bindable(''),
    variant = $bindable(''),
    preset = $bindable(''),
    locale = $bindable(''),
    loadingModels,
    modelOptions,
    variants,
    presetOptions,
    onSave,
  }: {
    open: boolean
    selectedRef: string
    variant: string
    preset: string
    locale: string
    loadingModels: boolean
    modelOptions: Array<{ value: string; label: string }>
    variants: ModelVariantInfo[]
    presetOptions: string[]
    onSave: () => void
  } = $props()
</script>

<Dialog bind:open title={t('settingsTitle')}>
  {#snippet children()}
    <div class="space-y-3">
      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('modelLabel')}</span>
        <Select
          bind:value={selectedRef}
          placeholder={loadingModels ? t('loading') : t('none')}
          items={modelOptions}
        />
      </label>
      {#if variants.length}
        <label class="block">
          <span class="mb-1 block text-meta text-muted-foreground">{t('variantLabel')}</span>
          <Select
            bind:value={variant}
            items={[{ value: '', label: t('variantNone') }, ...variants.map(v => ({ value: v.id, label: v.name || v.id }))]}
          />
        </label>
      {/if}
      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('presetLabel')}</span>
        <Select bind:value={preset} items={presetOptions.map(id => ({ value: id, label: id }))} />
      </label>
      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('agentLocale')}</span>
        <Select
          bind:value={locale}
          items={[
            { value: '', label: t('agentLocaleFollow') },
            { value: 'zh', label: '中文' },
            { value: 'en', label: 'English' },
          ]}
        />
      </label>
      <p class="text-micro text-muted-foreground">{t('turnsByPreset')}</p>
      <p class="text-micro text-muted-foreground">{t('sysPromptByPreset')}</p>
    </div>
  {/snippet}
  {#snippet footer()}
    <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (open = false)}>{t('cancel')}</button>
    <button type="button" class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80" onclick={onSave}>{t('save')}</button>
  {/snippet}
</Dialog>
