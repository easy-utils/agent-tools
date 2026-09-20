// Shared page prop bag handed to every routed page by the Shell.
import type { AppStore } from './store.svelte'
import type { BackendCfg } from './models'
import type { ThemeMode } from './prefs'

export interface PageProps {
  store: AppStore
  themeMode: ThemeMode
  onThemeMode: (v: ThemeMode) => void
  onSwitchBackend?: (() => void) | null
  onBackendSwitched?: ((b: BackendCfg) => void) | null
  onUiLocale?: ((l: 'system' | 'zh' | 'en') => void) | null
  /** Clears the active connection and lands on the setup form so the user can
   *  sign in as someone else (Flutter's `onAddUser`). */
  onAddUser?: (() => void) | null
  showBack?: boolean
  initialId?: string
  overlay?: 'mailbox'
  modelId?: string | null
}
