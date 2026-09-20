<script lang="ts">
  // Shared startup / loading surface.
  //
  // One visual contract across all four clients (Flutter, WebUI, Compose,
  // SwiftUI): a centered rounded square MARK (each client's own two-letter
  // mark), the app title, and a ring. The web clients ALSO render the same
  // layout in index.html before the bundle boots (see index.html), removed
  // here on mount.
  //
  // Keep in sync with: flutter LoadingScreen, compose LoadingScreen,
  // swiftui LoadingScreen, and the three index.html splashes.
  import { t } from '$lib/i18n.svelte'
  import { AppIcons } from '$lib/icons'
</script>

<div class="flex h-full flex-col items-center justify-center gap-4 bg-background text-foreground">
  <!-- WebUI mark: AW / violet #7c3aed -->
  <div
    class="flex size-10 items-center justify-center rounded-[10px] text-[16px] font-semibold text-white"
    style="background:#7c3aed;font-family:var(--font-mono)"
  >AW</div>
  <div class="text-body">{t('appTitle')}</div>
  <span
    class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
  ></span>
</div>
