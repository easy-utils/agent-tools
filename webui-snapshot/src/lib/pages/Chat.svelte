<script lang="ts">
  // Chat — web port of flutter screens/chat.dart: top bar (status lamp,
  // context tokens, name pill → settings, menu: compact/mailbox/fork/delete),
  // local-first message list (load-more at top, follow-bottom), composer with
  // draft persistence, attachment tiles (upload/retry/remove), attach sheet,
  // drag&drop, clipboard media paste, voice recording and settings dialog.
  import type { PageProps } from '$lib/page-props'
  import { MessagesController } from '$lib/messages.svelte'
  import { untrack } from 'svelte'
  import { t } from '$lib/i18n.svelte'
  import { confirmDialog, promptDialog } from '$lib/dialogs'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { guessMime, mimeToKind } from '$lib/media'
  import type { ModelInfo, Preset, ProviderInfo, Session, UploadedFile } from '$lib/models'
  import { modelRefOf, sessionName } from '$lib/models'
  import { buildModelOptions, fmtContext, fmtElapsed, variantsFor } from '$lib/chat-helpers'
  import { composerAction } from '$lib/composer-action'
  import { VoiceRecorder } from '$lib/voice'
  import { cn } from '$lib/utils'
  import IconButton from '$lib/components/layout/IconButton.svelte'
  import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '$lib/components/ui/dropdown-menu'
  import { AppIcons } from '$lib/icons'
  import MessageBubble from '$lib/components/MessageBubble.svelte'
  import MediaAttachment from '$lib/components/MediaAttachment.svelte'
  import ChatInfoDialog from './ChatInfoDialog.svelte'
  import ChatSettingsDialog from './ChatSettingsDialog.svelte'
  import ReconnectBanner from '$lib/components/ReconnectBanner.svelte'

  let { store }: PageProps = $props()

  // The controller instance is REACTIVE: switching sessions replaces it, and
  // the message list must re-render against the NEW one. With a plain (non
  // $state) field the template kept reading the old controller — the header
  // updated (it derives from the store) while the message list did not, which
  // is exactly the "switch chat, content does not refresh" bug. Disposal reads
  // it through `untrack` so the effect does not depend on it.
  let ctrl = $state<MessagesController | null>(null)
  let providers = $state<Record<string, ProviderInfo>>({})
  let presets: Preset[] = $state([])
  let localUrls = $state<Record<string, string>>({})

  // settings dialog state
  let settingsOpen = $state(false)
  let infoOpen = $state(false)
  let selectedRef = $state('')
  let variant = $state('')
  let preset = $state('')
  let locale = $state('')
  let allModels = $state<ModelInfo[]>([])
  let loadingModels = $state(false)
  let modelsLoaded = $state(false)

  // composer state
  let text = $state('')
  let attachments = $state<UploadedFile[]>([])
  let recording = $state(false)
  // Voice mode (mic/keyboard toggle) + hold-to-talk elapsed label, matching
  // flutter's `_voiceMode` / `_voiceElapsed`.
  let voiceMode = $state(false)
  let voiceElapsed = $state(0)
  let voiceTimer: ReturnType<typeof setInterval> | null = null
  // Bumped on every press/release so a late-resolving start() cannot show a
  // stale error after the user already let go.
  let recordToken = 0
  // Bottom sheet for the "+" affordance (flutter `_openAttachSheet`).
  let attachOpen = $state(false)
  let dragging = $state(false)
  let followBottom = $state(true)

  let listEl: HTMLElement | null = $state(null)
  let taEl: HTMLTextAreaElement | null = $state(null)
  const recorder = new VoiceRecorder()

  const session = $derived<Session | null>(store.activeSession)
  const sid = $derived(session?.id ?? '')

  // (Re)boot the controller whenever the open session changes.
  $effect(() => {
    const id = sid
    if (!id) {
      untrack(() => {
        ctrl?.dispose()
        ctrl = null
      })
      return
    }
    const prev = untrack(() => ctrl)
    const c = new MessagesController(store.api, () => id, store.local)
    ctrl = c
    prev?.dispose()
    c.init()
    void loadMeta()
    return () => {
      c.dispose()
    }
  })

  // Restore the draft ONLY when the open session changes. Kept in a separate
  // effect that reads `chatDrafts` NON-reactively: draft persistence mutates
  // that `$state` on every debounced keystroke/upload, and depending on it here
  // re-ran the controller boot above — rebuilding the controller and re-fetching
  // messages on every keystroke (the message list flickered).
  $effect(() => {
    const id = sid
    const d = untrack(() => store.chatDrafts[id])
    text = d?.text ?? ''
    // RESTORE DEFENSIVELY: a draft persisted before dedupe-by-code existed can
    // list the same file twice. Two entries sharing a code collide on the
    // composer's {#each} key and Svelte throws each_key_duplicate, which kills
    // the whole pane render. Also drop dead blob: URLs (from a previous load)
    // so the tile falls back to the server thumbnail.
    const seen = new Set<string>()
    attachments = (d?.attachments ?? [])
      .filter(a => (seen.has(a.code) ? false : (seen.add(a.code), true)))
      .map(a =>
        a.localPath?.startsWith('blob:') ? { ...a, localPath: '' } : a,
      )
  })

  async function loadMeta() {
    try {
      providers = await store.api.providers()
    } catch (e) {
      showErrorToast(t('loadError', { e: String(e) }))
    }
    try {
      presets = await store.api.presets()
    } catch (e) {
      showErrorToast(t('loadError', { e: String(e) }))
    }
  }

  // ---- scroll behaviour ----

  function onScroll() {
    if (!listEl) return
    const nearBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 80
    followBottom = nearBottom
    if (listEl.scrollTop < 60 && ctrl?.hasMore && !ctrl.loading) {
      void ctrl.loadMore()
    }
  }

  $effect(() => {
    if (!ctrl || !listEl) return
    void ctrl.revision
    if (followBottom) {
      requestAnimationFrame(() => {
        if (listEl) listEl.scrollTop = listEl.scrollHeight
      })
    }
  })

  // ---- draft persistence ----

  let draftTimer: ReturnType<typeof setTimeout> | null = null
  function persistDraft() {
    if (!sid) return
    store.saveDraftText(sid, text)
    store.saveDraftAttachments(sid, attachments)
  }

  /** SAME metric classes for the textarea and the hold-to-talk button: one
   *  source of truth for font-size / line-height / padding / block layout, so
   *  the text origin is identical in both modes (see the composer markup).
   *  Text is TOP-anchored via padding; do NOT centre it with flex, which
   *  rounds (contentH - lineH) / 2 and shifts the label by half a pixel. */
  const INNER_FIELD =
    'block w-full min-h-[42px] border-0 bg-transparent px-3 py-[10px] text-sm leading-[21px]'

  /** Auto-grow the composer textarea to its content (capped at 160px). */
  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  function schedulePersist() {
    draftTimer && clearTimeout(draftTimer)
    draftTimer = setTimeout(persistDraft, 300)
  }

  // Restore the composer height when leaving voice mode. The textarea stays
  // MOUNTED while hidden, so its value + inline height survive; re-applying
  // the auto-grow keeps the box correct even if the width changed while it
  // was invisible (a wrong height there is what used to collapse a
  // multi-line draft back to one line).
  $effect(() => {
    if (voiceMode) return
    const el = taEl
    if (!el) return
    // Track the value so the height is recomputed whenever the draft changes.
    void text
    autoGrow(el)
  })

  // ---- sending ----
  // ONE path for both idle and busy sessions: every prompt goes to the mailbox,
  // and the user bubble is rendered ONLY when the server's message-added event
  // arrives. The composer is locked (spinner) until then — `ctrl.awaitingSend`.
  // While a turn is RUNNING the action circle shows an envelope; sending it
  // plays a fly-to-mailbox animation.

  // Uploads currently in flight (so submit can await them all first).
  const inflightUploads = new Set<Promise<void>>()
  /** True while a submit is in progress (uploads awaited, RPC in flight). */
  let submitting = $state(false)

  // The composer is locked ONLY by OUR OWN in-flight send — never by a turn
  // running on the server. A running turn is exactly when the envelope
  // (deliver-to-mailbox) is shown and expected to WORK; gating on
  // `ctrl.sending` made the mailbox button a no-op while a turn ran.
  const hasContent = $derived(!!text.trim() || attachments.some(a => a.code))

  // The one action circle's state, resolved from the flags (composer-action.ts
  // owns the precedence). `deliver` outranks `stop` while a turn runs.
  const action = $derived(
    composerAction({
      awaitingSend: ctrl?.awaitingSend ?? false,
      sending: ctrl?.sending ?? false,
      canDeliver: !!(
        ctrl?.sending &&
        (text.trim() || attachments.length)
      ),
      submitting,
      canSend: hasContent && !!ctrl && !ctrl.sending && !ctrl.awaitingSend,
    }),
  )

  // ---- deliver-to-mailbox animation ----
  let envelopeBtnEl: HTMLElement | null = $state(null)
  let mailboxBtnEl: HTMLElement | null = $state(null)
  let flyFrom = $state<{ x: number; y: number } | null>(null)
  let flyTo = $state<{ x: number; y: number } | null>(null)
  let flyEl: HTMLElement | null = $state(null)

  /** True when the action should read as "deliver to mailbox" (busy session
   *  with content to send). */
  function canDeliver(): boolean {
    return !!(ctrl?.sending && (text.trim() || attachments.length))
  }

  /** FLIP the envelope glyph from the composer button to the mailbox button. */
  function startFly() {
    const f = envelopeBtnEl
    const t = mailboxBtnEl
    if (!f || !t) return
    const a = f.getBoundingClientRect()
    const b = t.getBoundingClientRect()
    flyFrom = { x: a.left + a.width / 2, y: a.top + a.height / 2 }
    flyTo = { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  }

  // Run the fly animation once the ghost is mounted, then clear it.
  $effect(() => {
    const el = flyEl
    const from = flyFrom
    const to = flyTo
    if (!el || !from || !to) return
    const dx = to.x - from.x
    const dy = to.y - from.y
    const anim = el.animate(
      [
        { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1 },
        {
          transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - 40}px)) scale(0.85) rotate(-16deg)`,
          opacity: 1,
          offset: 0.55,
        },
        {
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.35) rotate(-32deg)`,
          opacity: 0,
        },
      ],
      { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)' },
    )
    anim.onfinish = () => {
      flyFrom = null
      flyTo = null
    }
  })

  async function submit() {
    // Block only our OWN pending send, not a server-side turn: delivering to
    // the mailbox while a turn runs is the whole point of the envelope.
    if (!ctrl || submitting || ctrl.awaitingSend) return
    submitting = true
    try {
      // Wait for every in-flight upload before sending (never a partial batch).
      if (inflightUploads.size) await Promise.allSettled([...inflightUploads])
      const failed = attachments.filter(a => a.uploadState === 'error' || !a.code || a.code.startsWith('tmp-'))
      if (failed.length) {
        showErrorToast(t('uploadFailedRetry', { arg1: failed.length }))
        return
      }
      const body = text
      const files = attachments.filter(a => a.code)
      // Capture the source rect BEFORE clearing the draft: clearing morphs the
      // envelope button back to STOP and unmounts it.
      if (canDeliver()) startFly()
      text = ''
      attachments = []
      persistDraft()
      // Mailbox-only: the composer stays busy until message-added confirms the
      // write; the bubble is rendered by the server event, not optimistically.
      await ctrl.deliver(body, files)
    } catch {
      /* error bubble already added by the controller */
    } finally {
      submitting = false
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  // ---- attachments ----

  async function uploadOne(src: { name: string; mimeType: string; bytes: Uint8Array }) {
    if (!sid) return
    const localKey = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    localUrls[localKey] = URL.createObjectURL(new Blob([new Uint8Array(src.bytes)], { type: src.mimeType }))
    const pending: UploadedFile = {
      code: localKey,
      name: src.name,
      mime: src.mimeType,
      size: src.bytes.length,
      localPath: localUrls[localKey],
      deduped: false,
      uploadState: 'uploading',
      sha256: null,
    }
    attachments = [...attachments, pending]
    // Match by the STABLE local `code`, never object identity: Svelte 5 wraps
    // the object pushed into the `$state` array in a proxy, so the element in
    // `attachments` is a different reference than `pending` and an `a ===
    // pending` check would never fire — the tile stayed "uploading" forever.
    const job = (async () => {
      try {
        // Real byte-level progress (XHR upload), so the tile can show a true
        // percentage instead of a spinner for large uploads.
        const done = await store.api.uploadFile(
          { path: '', name: src.name, mimeType: src.mimeType, bytes: src.bytes },
          (d, total) => {
            const pct = total > 0 ? Math.round((d / total) * 100) : -1
            attachments = attachments.map(a =>
              a.code === localKey && a.uploadState === 'uploading'
                ? { ...a, uploadPct: pct }
                : a,
            )
          },
        )
        const finished = { ...done, localPath: localUrls[localKey] ?? '' }
        if (localUrls[localKey] !== undefined) {
          // Re-key the object URL onto the server code so it is revocable and
          // the persisted draft references a stable key.
          localUrls[finished.code] = localUrls[localKey]!
          delete localUrls[localKey]
        }
        // DEDUPE BY CODE: the agent returns the SAME code for identical bytes,
        // so re-picking a file already in the list must not create a second
        // entry — two entries sharing a code also break the keyed {#each}.
        attachments = attachments.some(a => a.code === finished.code)
          ? attachments.filter(a => a.code !== localKey)
          : attachments.map(a => (a.code === localKey ? finished : a))
      } catch (e) {
        attachments = attachments.map(a =>
          a.code === localKey ? { ...a, uploadState: 'error', error: String(e) } : a,
        )
      }
      schedulePersist()
    })()
    inflightUploads.add(job)
    try { await job } finally { inflightUploads.delete(job) }
  }

  function removeAttachment(a: UploadedFile) {
    attachments = attachments.filter(x => x.code !== a.code)
    if (localUrls[a.code]) {
      URL.revokeObjectURL(localUrls[a.code])
      delete localUrls[a.code]
    }
    schedulePersist()
  }

  async function retryUpload(a: UploadedFile) {
    if (!a.localPath) return
    try {
      const res = await fetch(a.localPath)
      const blob = await res.blob()
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const done = await store.api.uploadFile({
        path: '',
        name: a.name ?? 'file',
        mimeType: a.mime ?? blob.type,
        bytes,
      })
      attachments = attachments.map(x => (x.code === a.code ? done : x))
    } catch (e) {
      showErrorToast(String(e))
    }
    schedulePersist()
  }

  function pickFiles(accept: string) {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    if (accept) input.accept = accept
    input.onchange = () => {
      for (const f of input.files ?? []) {
        void f.arrayBuffer().then(buf =>
          uploadOne({ name: f.name, mimeType: f.type || guessMime(f.name), bytes: new Uint8Array(buf) }),
        )
      }
    }
    input.click()
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    dragging = false
    for (const f of e.dataTransfer?.files ?? []) {
      const buf = new Uint8Array(await f.arrayBuffer())
      void uploadOne({ name: f.name, mimeType: f.type || guessMime(f.name), bytes: buf })
    }
  }

  function onPaste(e: ClipboardEvent) {
    for (const item of e.clipboardData?.items ?? []) {
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (!f) continue
        e.preventDefault()
        void f.arrayBuffer().then(buf =>
          uploadOne({ name: f.name || 'pasted.png', mimeType: f.type || guessMime(f.name), bytes: new Uint8Array(buf) }),
        )
      }
    }
  }

  // ---- voice ----

  /** Hold-to-talk (flutter `_holdToTalkButton`): press starts, release uploads. */
  async function startRecording() {
    if (recording) return
    recording = true
    const token = ++recordToken
    voiceElapsed = 0
    voiceTimer = setInterval(() => (voiceElapsed += 200), 200)
    const ok = await recorder.start()
    // A release may have landed while the mic was still opening (the recorder
    // then releases the stream and returns false). Only surface a permission
    // error when THIS press is still the active one.
    if (token !== recordToken) return
    if (!ok) {
      // Roll the optimistic UI state back so a denied mic does not leave the
      // button stuck in "recording".
      if (voiceTimer) { clearInterval(voiceTimer); voiceTimer = null }
      recording = false
      showErrorToast(t('voicePermission'))
    }
  }

  async function stopRecording() {
    if (voiceTimer) { clearInterval(voiceTimer); voiceTimer = null }
    if (!recording) return
    recordToken++ // invalidate the pending start() error path
    recording = false
    // `recorder.stop()` releases the mic (stops every track) BEFORE the bytes
    // are uploaded, so the recording indicator clears immediately on release.
    const src = await recorder.stop()
    if (src) void uploadOne(src)
    else showToast(t('voiceTooShort'))
  }

  /** AppIcons.camera capture (flutter `_pickImage(ImageSource.camera)`). */
  function takePhoto() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.capture = 'environment'
    input.onchange = () => {
      for (const f of input.files ?? []) {
        void f.arrayBuffer().then(buf =>
          uploadOne({ name: f.name || 'photo.jpg', mimeType: f.type || guessMime(f.name), bytes: new Uint8Array(buf) }),
        )
      }
    }
    input.click()
  }

  // ---- settings dialog ----

  async function showSettings() {
    if (!session) return
    selectedRef = session.model
    variant = session.variant
    preset = session.preset
    locale = session.locale ?? ''
    settingsOpen = true
    if (!modelsLoaded) {
      loadingModels = true
      const out: ModelInfo[] = []
      for (const pid of Object.keys(providers)) {
        try {
          out.push(...(await store.api.models(pid)))
        } catch {
          /* provider skipped */
        }
      }
      allModels = out
      loadingModels = false
      modelsLoaded = true
      if (out.length && !out.some(m => modelRefOf(m) === selectedRef)) {
        selectedRef = modelRefOf(out[0]!)
      }
    }
  }

  const modelOptions = $derived(buildModelOptions(allModels, selectedRef))

  const variantsForModel = $derived(variantsFor(allModels, selectedRef))

  $effect(() => {
    if (variantsForModel.length && !variantsForModel.some(v => v.id === variant)) variant = ''
  })

  async function applySettings() {
    settingsOpen = false
    if (!sid) return
    try {
      const updated = await store.api.settings(sid, {
        ...(selectedRef ? { model: selectedRef } : {}),
        variant,
        ...(preset ? { preset } : {}),
        locale,
      })
      store.applySession(updated)
      showToast(t('saved'))
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  // ---- menu actions ----

  async function menuAction(v: string) {
    switch (v) {
      case 'compact': {
        const ok = await confirmDialog({ title: t('compactHistory'), body: t('compactConfirm'), confirmLabel: t('apply') })
        if (ok && sid) {
          try {
            await store.api.compact(sid)
            showToast(t('compactedLabel'))
          } catch (e) {
            showErrorToast(String(e))
          }
        }
        break
      }
      case 'mailbox':
        store.pushPage({ kind: 'chat_overlay', key: 'chat_overlay', overlay: 'mailbox' })
        break
      case 'fork': {
        const branch = await promptDialog({ title: t('fork'), confirmLabel: t('create') })
        if (!branch) return
        const ok = await store.forkSession(branch)
        if (ok) showToast(t('saved'))
        else showErrorToast(t('forkFailed'))
        break
      }
      case 'delete': {
        const ok = await confirmDialog({ title: t('deleteSession'), body: session ? t('deleteSessionBody', { arg1: sessionName(session) }) : '', confirmLabel: t('delete'), destructive: true })
        if (ok && sid) {
          try {
            await store.deleteSession(sid)
          } catch (e) {
            showErrorToast(String(e))
          }
        }
        break
      }
    }
  }

  const ctxLabel = $derived(fmtContext((session?.lastInputTokens ?? 0) + (session?.lastOutputTokens ?? 0)))
  const presetOptions = $derived([
    ...presets.map(p => p.id),
    ...(preset && !presets.some(p => p.id === preset) ? [preset] : []),
  ])
  const tileDim = 56

  function isLocalPreview(a: UploadedFile): string {
    return a.localPath || localUrls[a.code] || ''
  }
</script>

{#if !sid}
  <div class="flex h-full items-center justify-center text-meta text-muted-foreground">{t('noSessions')}</div>
{:else if ctrl}
  <div
    class="relative flex h-full w-full min-h-0 flex-col" role="application"
    ondragover={e => {
      e.preventDefault()
      dragging = true
    }}
    ondragleave={e => {
      // Only clear when the pointer actually leaves the container, not when it
      // crosses an inner child (which also fires dragleave).
      if (e.relatedTarget && (e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return
      dragging = false
    }}
    ondrop={e => void onDrop(e)}
  >
    <!-- top bar -->
    <header class="relative flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
      <div class="flex min-w-0 items-center gap-2">
        <IconButton icon={AppIcons.back} label={t('back')} onclick={() => store.popPage()} />
        <span class={cn('size-2 rounded-full', ctrl.sending ? 'bg-warning' : 'bg-success')}></span>
        {#if ctxLabel}
          <span class="text-micro text-muted-foreground tabular-nums">{ctxLabel}</span>
        {/if}
      </div>
      <div class="pointer-events-none absolute inset-x-0 flex justify-center">
        <button
          type="button"
          class="pointer-events-auto min-w-24 max-w-40 truncate rounded-full bg-primary/14 px-3 py-1 text-center text-meta font-semibold text-primary"
          onclick={() => (infoOpen = true)}
          title={t('settingsTitle')}
        >
          {session?.id}
        </button>
      </div>
      <div class="ml-auto flex items-center gap-0.5">
        <!-- Mailbox, extracted from the ⋯ menu into its own button. The red
             dot (top-right) counts PENDING (unconsumed) mailbox entries. -->
        <div bind:this={mailboxBtnEl} class="relative">
          <IconButton icon={AppIcons.inbox} label={t('mailbox')} onclick={() => void menuAction('mailbox')} />
          {#if (ctrl?.pendingMailbox ?? 0) > 0}
            <span class="pointer-events-none absolute top-0.5 right-0.5 flex min-w-[14px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] leading-[14px] font-bold text-destructive-foreground">
              {ctrl?.pendingMailbox}
            </span>
          {/if}
        </div>
        <DropdownMenu label={t('settingsTitle')}>
          <DropdownMenuItem onSelect={() => void menuAction('compact')}>{t('compactHistory')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void menuAction('fork')}>{t('fork')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem class="text-destructive" onSelect={() => void menuAction('delete')}>{t('deleteSession')}</DropdownMenuItem>
        </DropdownMenu>
      </div>
    </header>

    <!-- reconnecting strip (below the header, in-page, not app-wide) -->
    <ReconnectBanner />

    <!-- messages -->
    <div bind:this={listEl} class="min-h-0 flex-1 overflow-y-auto px-3 py-3" onscroll={onScroll}>
      {#if ctrl.loading && ctrl.messages.length === 0}
        <div class="flex h-full items-center justify-center">
          <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
        </div>
      {:else}
        {#if ctrl.hasMore}
          <div class="mb-2 flex justify-center">
            <button
              type="button"
              class="rounded px-2 py-1 text-sm text-primary hover:bg-muted disabled:opacity-50"
              disabled={ctrl.loading}
              onclick={() => void ctrl!.loadMore()}
            >{ctrl.loading ? t('loading') : t('loadEarlier')}</button>
          </div>
        {/if}
        {#each ctrl.sorted as msg (msg.id)}
          <MessageBubble
            {msg}
            sessionId={sid}
            api={store.api}
            onUndo={id => void ctrl!.revert(id)}
            onResend={txt => void ctrl!.resendFrom(ctrl!.messages.find(m => m.id === msg.id)!, txt)}
            onEdit={txt => void ctrl!.resendFrom(ctrl!.messages.find(m => m.id === msg.id)!, txt)}
            onOpenSession={name => store.pickSession(name)}
            sessionExists={name => store.sessionById(name) !== null}
          />
        {/each}
      {/if}
    </div>

    <!-- composer -->
    <div class="shrink-0 border-t border-border bg-card px-3 pt-1 pb-1">
      {#if attachments.length}
        <div class="mb-2 flex flex-wrap gap-1 pt-1">
          {#each attachments as a (a.code)}
            <div class="relative">
              <MediaAttachment
                api={store.api}
                code={a.code}
                name={a.name ?? ''}
                mime={a.mime}
                size={a.size ?? null}
                dimension={tileDim}
                localUrl={isLocalPreview(a)}
              />
              <button
                type="button"
                class={cn(
                  'absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full text-[10px] text-white',
                  a.uploadState === 'uploading' ? 'bg-muted-foreground/70'
                  : a.uploadState === 'error' ? 'bg-destructive'
                  : 'bg-muted-foreground/70 hover:bg-destructive',
                )}
                onclick={() => (a.uploadState === 'error' ? void retryUpload(a) : removeAttachment(a))}
                title={a.uploadState === 'error' ? t('retry') : t('delete')}
              >
                {#if a.uploadState === 'uploading' && a.uploadPct != null && a.uploadPct >= 0}
                  <!-- True byte progress beats an indeterminate spinner. -->
                  <span class="text-[9px] font-semibold tabular-nums">{a.uploadPct}%</span>
                {:else if a.uploadState === 'uploading'}<span class="block size-2.5 animate-spin rounded-full border border-white/40 border-t-white"></span>{:else if a.uploadState === 'error'}<AppIcons.refresh class="size-2.5" />{:else}<AppIcons.close class="size-2.5" />{/if}
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <div class="flex items-center gap-2">
        <!-- Left: mic/keyboard toggle. Same 42px slot as the action circle on
             the right so the three slots share one center and symmetric gaps. -->
        <button
          type="button"
          class="flex size-[42px] shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-muted disabled:opacity-40"
          title={voiceMode ? t('keyboardMode') : t('voiceMode')}
          aria-label={voiceMode ? t('keyboardMode') : t('voiceMode')}
          onclick={() => (voiceMode = !voiceMode)}
        >
          {#if voiceMode}<AppIcons.keyboard class="size-[22px]" />{:else}<AppIcons.mic class="size-[22px]" />{/if}
        </button>

        <!-- Field shell: SHARED by both modes and never replaced, so the
             geometry cannot drift between keyboard and voice. Border, radius,
             background and the minimum height live HERE (one place), and the
             recording tint is applied to this same box.

             The inner control (textarea or hold-to-talk button) uses the SAME
             metric class string (INNER_FIELD) in both branches: identical
             font-size/line-height/padding, block layout, top-anchored text.
             That is what makes the text origin sub-pixel identical — an
             earlier version centred the voice label with flex
             (`(42-21)/2 = 10.5px`) while the textarea anchored it with
             `padding-top:10px`, so the label sat 0.5px lower and the composer
             visibly twitched on every mic/keyboard switch.

             The textarea stays MOUNTED in voice mode (only hidden): unmounting
             it discarded the inline height the auto-grow handler had set, so
             returning from voice collapsed a multi-line draft back to one
             line. -->
        <div
          class={cn(
            'relative min-h-[44px] flex-1 rounded-md border',
            recording
              ? 'border-destructive bg-destructive/12'
              : 'border-border/60 bg-muted',
          )}
        >
          <textarea
            bind:this={taEl}
            bind:value={text}
            rows="1"
            class={cn(
              INNER_FIELD,
              'max-h-40 resize-none outline-none placeholder:text-muted-foreground',
              voiceMode && 'invisible',
            )}
            placeholder={attachments.length ? '' : t('typeMessage')}
            onkeydown={onKeydown}
            onpaste={onPaste}
            oninput={e => {
              schedulePersist()
              autoGrow(e.currentTarget)
            }}
          ></textarea>

          {#if voiceMode}
            <button
              type="button"
              class={cn(
                INNER_FIELD,
                // `touch-none` + no text selection + no iOS long-press callout:
                // a press-and-hold must NOT open the browser's native context /
                // copy-paste panel, which would cancel the recording.
                // `items-start` is load-bearing: a <button>'s UA style
                // vertically CENTRES its content box, so the label landed at
                // (42-21)/2 = 10.5px while the textarea anchored it at
                // padding-top: 10px. Top-aligning makes both text origins
                // compute from the same padding (sub-pixel identical) instead
                // of relying on two coincidentally-close numbers.
                'absolute inset-0 flex items-start justify-center touch-none select-none [-webkit-touch-callout:none]',
                recording
                  ? 'font-semibold text-destructive'
                  : 'text-muted-foreground',
              )}
              oncontextmenu={e => e.preventDefault()}
              onpointerdown={e => {
                // Capture the pointer so pointerup fires even if the finger
                // drifts off the button; suppress the native long-press menu.
                e.preventDefault()
                try {
                  e.currentTarget.setPointerCapture(e.pointerId)
                } catch {
                  /* unsupported */
                }
                void startRecording()
              }}
              onpointerup={() => void stopRecording()}
              onpointercancel={() => void stopRecording()}
            >
              {recording ? `${t('releaseToSend')} · ${fmtElapsed(voiceElapsed)}` : t('holdToTalk')}
            </button>
          {/if}
        </div>

        <!-- Right: one morphing action circle — WHITE fill with a colored
             outline + colored glyph. While a turn RUNS the circle keeps its
             STOP form; the moment the user types/records, it morphs into the
             ENVELOPE (deliver to mailbox). Otherwise: blue send / muted
             attach, never a solid colored fill. -->
        {#if action === 'awaiting-send'}
          <!-- A prompt is en route to the mailbox (RPC then server confirm):
               the composer is locked and shows a spinner until the user
               bubble appears from the server's message-added event. -->
          <button type="button" class="flex size-[42px] shrink-0 items-center justify-center rounded-full border border-primary bg-card text-primary" title={t('connecting')} aria-label={t('connecting')} disabled><span class="block size-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary"></span></button>
        {:else if action === 'deliver'}
          <button
            type="button"
            bind:this={envelopeBtnEl}
            class="flex size-[42px] shrink-0 items-center justify-center rounded-full border border-primary bg-card text-primary"
            title={t('deliver')}
            aria-label={t('deliver')}
            onclick={() => void submit()}
          ><AppIcons.mail class="size-5" /></button>
        {:else if action === 'stop'}
          <button type="button" class="flex size-[42px] shrink-0 items-center justify-center rounded-full border border-destructive bg-card text-destructive" title={t('abort')} aria-label={t('abort')} onclick={() => ctrl!.stop()}><AppIcons.stop class="size-5" /></button>
        {:else if action === 'submitting'}
          <button type="button" class="flex size-[42px] shrink-0 items-center justify-center rounded-full border border-primary bg-card text-primary" title={t('connecting')} aria-label={t('connecting')} disabled><span class="block size-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary"></span></button>
        {:else if action === 'send'}
          <button type="button" class="flex size-[42px] shrink-0 items-center justify-center rounded-full border border-primary bg-card text-primary disabled:opacity-40" title={t('send')} aria-label={t('send')} onclick={() => void submit()}><AppIcons.send class="size-5" /></button>
        {:else}
          <button type="button" class="flex size-[42px] shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground" title={t('attach')} aria-label={t('attach')} onclick={() => (attachOpen = true)}><AppIcons.add class="size-5" /></button>
        {/if}
      </div>
    </div>

    <!-- attach bottom sheet (flutter `_openAttachSheet`) -->
    {#if attachOpen}
      <div
        class="fixed inset-0 z-[70] flex items-end bg-black/50"
        role="presentation"
        onclick={e => {
          // Close on backdrop tap only (not when the tap lands on the sheet).
          if (e.target === e.currentTarget) attachOpen = false
        }}
      >
        <div class="w-full rounded-t-xl border-t border-border bg-card pb-3" role="presentation">
          <div class="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-muted-foreground/30"></div>
          <button type="button" class="flex w-full items-center gap-4 px-4 py-3 text-left text-body hover:bg-muted" onclick={() => { attachOpen = false; takePhoto() }}>
            <AppIcons.camera class="size-[22px]" /> {t('takePhoto')}
          </button>
          <button type="button" class="flex w-full items-center gap-4 px-4 py-3 text-left text-body hover:bg-muted" onclick={() => { attachOpen = false; pickFiles('image/*') }}>
            <AppIcons.image class="size-[22px]" /> {t('chooseImage')}
          </button>
          <button type="button" class="flex w-full items-center gap-4 px-4 py-3 text-left text-body hover:bg-muted" onclick={() => { attachOpen = false; pickFiles('') }}>
            <AppIcons.attach class="size-[22px]" /> {t('chooseFile')}
          </button>
        </div>
      </div>
    {/if}

    <!-- drop overlay -->
    {#if dragging}
      <div class="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-primary/8">
        <div class="flex items-center gap-2 rounded-lg border-2 border-primary bg-card px-4 py-3 text-body">
          <AppIcons.download class="size-6" />
          {t('dropToAttach')}
        </div>
      </div>
    {/if}

    <!-- flying letter: the envelope glyph animates from the composer button to
         the top-bar mailbox button after a delivery. -->
    {#if flyFrom && flyTo}
      <div
        bind:this={flyEl}
        class="pointer-events-none fixed z-[80] flex size-7 items-center justify-center rounded-full border border-primary bg-card text-primary shadow-md"
        style="left: {flyFrom.x}px; top: {flyFrom.y}px; transform: translate(-50%,-50%)"
      >
        <AppIcons.mail class="size-4" />
      </div>
    {/if}
  </div>

  <!-- session info dialog -->
  <ChatInfoDialog bind:open={infoOpen} {session} onEdit={() => void showSettings()} />

  <!-- settings dialog -->
  <ChatSettingsDialog
    bind:open={settingsOpen}
    bind:selectedRef
    bind:variant
    bind:preset
    bind:locale
    {loadingModels}
    {modelOptions}
    variants={variantsForModel}
    {presetOptions}
    onSave={() => void applySettings()}
  />
{/if}
