<script lang="ts">
  // ReconnectBanner — the in-page "reconnecting" strip shown at the top of a
  // page (below its header) while a long-lived SSE stream is down. Both the
  // session list and the open chat render it; the styles match a warning bar.
  import { t } from '$lib/i18n.svelte'
  import { connection } from '$lib/connection.svelte'
</script>

{#if connection.sessions || connection.chat}
  <div class="flex shrink-0 items-center justify-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-meta text-warning">
    <span class="size-3 animate-spin rounded-full border-2 border-warning/30 border-t-warning"></span>
    <span>{t('reconnecting')}</span>
  </div>
{/if}
