<script lang="ts">
  // FileRefText — port of flutter widgets/message_bubble.dart `_FileRefsText`:
  // splits a text part on embedded `[附件 <name> | file:<code> | <mime> | <size>]`
  // references and renders each as a media attachment, with the surrounding
  // prose rendered as markdown.
  import type { AgentApi } from '$lib/api'
  import { renderMarkdown } from '$lib/markdown'
  import MediaAttachment from './MediaAttachment.svelte'

  let {
    text,
    api,
  }: { text: string; api: AgentApi } = $props()

  const RE = /\[附件\s+(.+?)\s*\|\s*file:([0-9a-zA-Z]+)\s*\|\s*([^|\]]*)\s*\|\s*([^\]|]*)\]/g

  type Seg = { kind: 'md'; text: string } | { kind: 'file'; label: string; code: string; mime: string }

  const segments = $derived.by<Seg[]>(() => {
    RE.lastIndex = 0
    const out: Seg[] = []
    let idx = 0
    let m: RegExpExecArray | null
    while ((m = RE.exec(text)) !== null) {
      if (m.index > idx) out.push({ kind: 'md', text: text.slice(idx, m.index) })
      out.push({ kind: 'file', label: m[1]!.trim(), code: m[2]!, mime: m[3]!.trim() })
      idx = m.index + m[0].length
    }
    if (idx < text.length) out.push({ kind: 'md', text: text.slice(idx) })
    return out
  })

  const hasFile = $derived(segments.some(s => s.kind === 'file'))
</script>

{#if !hasFile}
  <div class="md-body w-full">{@html renderMarkdown(text)}</div>
{:else}
  <div class="flex w-full flex-col items-start gap-2">
    {#each segments as seg, i (i)}
      {#if seg.kind === 'md'}
        {#if seg.text.trim()}<div class="md-body w-full">{@html renderMarkdown(seg.text.trim())}</div>{/if}
      {:else}
        <MediaAttachment {api} code={seg.code} name={seg.label} mime={seg.mime} size={null} />
      {/if}
    {/each}
  </div>
{/if}
