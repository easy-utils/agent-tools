<script lang="ts">
  import { AppIcons } from '$lib/icons'
  // ModelRow — web port of flutter _ModelRow: one model in a provider draft
  // (kind icon, mono id, context/kind tag, remove).
  import type { ProviderModel } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import { capabilityLabelKey } from './common'
  import CapabilityIcon from './CapabilityIcon.svelte'

  let {
    model,
    onTap,
    onRemove,
  }: {
    model: ProviderModel
    onTap: () => void
    onRemove: () => void
  } = $props()

  const isText = $derived((model.contextLimit ?? 0) > 0)
  const type = $derived(isText ? 'text' : model.modelType)
</script>

<div class="mb-1 flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 py-1.5 pr-1.5 pl-3">
  <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" onclick={onTap}>
    <CapabilityIcon capability={type} size={14} />
    <span class="min-w-0 flex-1 truncate font-mono text-meta font-semibold">{model.id}</span>
    <span class="shrink-0 text-micro text-muted-foreground">
      {isText ? `${t('capText')} · ${model.contextLimit}` : t(capabilityLabelKey(type))}
    </span>
  </button>
  <button type="button" class="rounded p-1 text-muted-foreground hover:bg-muted" title={t('delete')} onclick={onRemove}><AppIcons.close class="size-4" /></button>
</div>
