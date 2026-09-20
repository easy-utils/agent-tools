<script lang="ts">
  // CsvView — parse CSV/TSV and render a table. Handles simple RFC-4180-ish
  // quoting; large files are capped so the DOM stays responsive.
  import { onMount } from 'svelte'
  import { t } from '$lib/i18n.svelte'

  let { src }: { src: string } = $props()

  let rows = $state<string[][]>([])
  let loading = $state(true)
  let truncated = $state(false)

  const MAX_ROWS = 2000

  function parse(text: string, delim: string): string[][] {
    const out: string[][] = []
    let row: string[] = []
    let field = ''
    let quoted = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"'
            i++
          } else quoted = false
        } else field += c
      } else if (c === '"') {
        quoted = true
      } else if (c === delim) {
        row.push(field)
        field = ''
      } else if (c === '\n') {
        row.push(field)
        out.push(row)
        row = []
        field = ''
        if (out.length >= MAX_ROWS) {
          truncated = true
          break
        }
      } else if (c !== '\r') {
        field += c
      }
    }
    if (!truncated && (field !== '' || row.length > 0)) {
      row.push(field)
      out.push(row)
    }
    return out
  }

  onMount(() => {
    void (async () => {
      try {
        const text = await (await fetch(src)).text()
        const header = text.slice(0, 4000)
        const delim = header.includes('\t') && !header.includes(',') ? '\t' : ','
        rows = parse(text, delim)
      } finally {
        loading = false
      }
    })()
  })
</script>

<div class="max-h-[80vh] w-[min(94vw,1000px)] overflow-auto rounded-md bg-white/5 p-2">
  {#if loading}
    <div class="p-6 text-center text-meta text-white/60">{t('loading')}</div>
  {:else}
    <table class="border-collapse text-[12px] text-white/90">
      <tbody>
        {#each rows as row, ri (ri)}
          <tr class={ri === 0 ? 'font-semibold' : ''}>
            {#each row as cell, ci (ci)}
              {#if ri === 0}
                <th class="sticky top-0 border border-white/15 bg-white/10 px-2 py-1 text-left">{cell}</th>
              {:else}
                <td class="border border-white/10 px-2 py-0.5">{cell}</td>
              {/if}
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    {#if truncated}
      <div class="p-2 text-micro text-white/50">… {MAX_ROWS} rows</div>
    {/if}
  {/if}
</div>
