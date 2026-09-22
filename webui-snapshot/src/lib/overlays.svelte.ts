// Global overlay store — imperative prompt/confirm/action-sheet/toast API
// backed by shadcn-svelte (bits-ui) components rendered by <Overlays/>.
// Callers keep the ergonomic promise-based API (mirrors flutter dialogs.dart).

export interface PromptReq {
  kind: 'prompt'
  id: number
  title: string
  body?: string
  initial: string
  placeholder: string
  confirmLabel: string
  cancelLabel: string
  multiline: boolean
  resolve: (v: string | null) => void
}

export interface ConfirmReq {
  kind: 'confirm'
  id: number
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  destructive: boolean
  resolve: (v: boolean) => void
}

export interface SheetReq {
  kind: 'sheet'
  id: number
  title: string
  actions: { value: string; label: string; destructive?: boolean }[]
  resolve: (v: string | null) => void
}

export interface ToastItem {
  id: number
  text: string
  error: boolean
}

let seq = 0

export const overlays = $state<{
  dialog: PromptReq | null
  confirm: ConfirmReq | null
  sheet: SheetReq | null
  toasts: ToastItem[]
}>({ dialog: null, confirm: null, sheet: null, toasts: [] })

export function promptDialog(opts: {
  title: string
  body?: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  multiline?: boolean
}): Promise<string | null> {
  return new Promise(resolve => {
    overlays.dialog = {
      kind: 'prompt',
      id: ++seq,
      title: opts.title,
      body: opts.body,
      initial: opts.initial ?? '',
      placeholder: opts.placeholder ?? '',
      confirmLabel: opts.confirmLabel ?? 'OK',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      multiline: opts.multiline ?? false,
      resolve,
    }
  })
}

export function confirmDialog(opts: {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}): Promise<boolean> {
  return new Promise(resolve => {
    overlays.confirm = {
      kind: 'confirm',
      id: ++seq,
      title: opts.title,
      body: opts.body ?? '',
      confirmLabel: opts.confirmLabel ?? 'OK',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      destructive: opts.destructive ?? false,
      resolve,
    }
  })
}

export function actionSheet(opts: {
  title: string
  actions: { value: string; label: string; destructive?: boolean }[]
}): Promise<string | null> {
  return new Promise(resolve => {
    overlays.sheet = {
      kind: 'sheet',
      id: ++seq,
      title: opts.title,
      actions: opts.actions,
      resolve,
    }
  })
}

export function showToast(text: string) {
  const id = ++seq
  overlays.toasts.push({ id, text, error: false })
  setTimeout(() => dismissToast(id), 2500)
}

export function showErrorToast(text: string) {
  const id = ++seq
  overlays.toasts.push({ id, text, error: true })
  setTimeout(() => dismissToast(id), 5000)
}

export function dismissToast(id: number) {
  overlays.toasts = overlays.toasts.filter(t => t.id !== id)
}

export function resolveDialog(v: string | null) {
  const d = overlays.dialog
  overlays.dialog = null
  d?.resolve(v)
}

export function resolveConfirm(v: boolean) {
  const c = overlays.confirm
  overlays.confirm = null
  c?.resolve(v)
}

export function resolveSheet(v: string | null) {
  const s = overlays.sheet
  overlays.sheet = null
  s?.resolve(v)
}
