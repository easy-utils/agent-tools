<script lang="ts">
  // CapabilityIcon — vector icon for a model capability (port of flutter
  // providers.dart capabilityIcon; replaces the earlier emoji glyphs).
  import { AppIcons } from '$lib/icons'

  let { capability, size = 14 }: { capability: string; size?: number } = $props()

  // Must be a CAPITALISED variable (or a member expression) so Svelte renders
  // it as a component: a lowercase `<icon>` is treated as an unknown HTML
  // element and silently draws nothing.
  const Glyph = $derived.by(() => {
    switch (capability) {
      case 'image': return AppIcons.image
      case 'video': return AppIcons.video
      case 'speech': return AppIcons.audio
      case 'transcription': return AppIcons.mic_vocal
      case 'embedding': return AppIcons.scatter
      case 'rerank':
      case 'reranking': return AppIcons.grip
      case 'realtime': return AppIcons.bolt
      default: return AppIcons.chat
    }
  })
  const tone = $derived.by(() => {
    switch (capability) {
      case 'image': return 'text-warning'
      case 'video': return 'text-destructive'
      case 'speech': return 'text-primary'
      case 'transcription': return 'text-accent'
      default: return 'text-success'
    }
  })
</script>

<Glyph class="{tone} shrink-0" style="width:{size}px;height:{size}px" />
