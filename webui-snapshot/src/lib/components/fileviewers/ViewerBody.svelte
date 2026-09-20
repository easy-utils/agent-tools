<script lang="ts">
  // ViewerBody — the non-media renderers (pdf / docx / xlsx / pptx / text /
  // code / markdown / json / csv / html). Each heavy library is dynamically
  // imported HERE so it only loads the first time such a file is opened.
  import type { AgentApi } from '$lib/api'
  import type { FileRef } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import {
    isTextMime,
    type PreviewKind,
  } from '$lib/media'
  import CodeView from './CodeView.svelte'
  import CsvView from './CsvView.svelte'
  import HtmlView from './HtmlView.svelte'
  import MarkdownView from './MarkdownView.svelte'
  import PdfView from './PdfView.svelte'
  import OfficeView from './OfficeView.svelte'

  let {
    file,
    kind,
    src,
  }: { api: AgentApi; file: FileRef; kind: PreviewKind; src: string } = $props()

  const textKind = $derived(
    kind === 'text' || kind === 'code' || kind === 'json' || kind === 'csv' || kind === 'html' || kind === 'markdown' || isTextMime(file.mime ?? ''),
  )
</script>

{#if kind === 'pdf'}
  <PdfView {src} />
{:else if kind === 'docx' || kind === 'xlsx' || kind === 'pptx'}
  <OfficeView {src} kind={kind} name={file.name ?? ''} />
{:else if kind === 'markdown'}
  <MarkdownView {src} />
{:else if kind === 'html'}
  <HtmlView {src} />
{:else if kind === 'csv'}
  <CsvView {src} />
{:else if kind === 'json' || kind === 'code' || kind === 'text' || textKind}
  <CodeView {src} kind={kind} name={file.name ?? ''} />
{:else}
  <div class="rounded-md bg-white/5 px-4 py-3 text-meta text-white/70">
    {t('fileUnsupported')}
  </div>
{/if}
