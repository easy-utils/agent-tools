<script lang="ts">
  // ChatInfoDialog — the read-only session-info sheet (model/variant/preset/
  // locale) with an edit affordance that hands off to the settings dialog.
  import { t } from '$lib/i18n.svelte'
  import { AppIcons } from '$lib/icons'
  import { Dialog } from '$lib/components/ui/dialog'
  import type { Session } from '$lib/models'

  let {
    open = $bindable(false),
    session,
    onEdit,
  }: {
    open: boolean
    session: Session | null
    /** "Edit": close this sheet and open the settings dialog. */
    onEdit: () => void
  } = $props()
</script>

<Dialog bind:open title={t('sessionInfo')}>
  {#snippet children()}
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <AppIcons.chat class="size-4 text-primary" />
        <span class="truncate text-meta font-bold">{session?.id}</span>
      </div>
      {#each [
        [t('modelLabel'), session?.model || t('none')],
        [t('variantLabel'), session?.variant || t('variantNone')],
        [t('presetLabel'), session?.preset || t('none')],
        [t('agentLocale'), session?.locale || t('agentLocaleFollow')],
      ] as [label, value] (label)}
        <div class="flex items-start gap-3 border-t border-border/40 pt-2 first:border-t-0 first:pt-0">
          <span class="w-24 shrink-0 text-micro text-muted-foreground">{label}</span>
          <span class="min-w-0 flex-1 text-meta font-semibold">{value}</span>
        </div>
      {/each}
    </div>
  {/snippet}
  {#snippet footer()}
    <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (open = false)}>{t('close')}</button>
    <button
      type="button"
      class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80"
      onclick={() => {
        open = false
        onEdit()
      }}
    >{t('edit')}</button>
  {/snippet}
</Dialog>
