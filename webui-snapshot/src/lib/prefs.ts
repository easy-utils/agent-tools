// Prefs — the web port of flutter/lib/prefs.dart over localStorage.
// (Drafts + read watermarks ALSO mirror into sqlite; this file holds the
// connection, appearance, locale and backend-list state.)
import { backendNameFor, type BackendCfg } from './models'
import { scopeOf } from './scope'

const K_BASE = 'agent.baseUrl'
const K_TOKEN = 'agent.token'
// Tri-state theme pref ("system" | "light" | "dark"), default follow-system.
// Older installs only stored the boolean agent.darkMode — it maps onto the
// explicit light/dark modes (never back to "system": the user chose).
const K_THEME = 'agent.themeMode'
const K_DARK_LEGACY = 'agent.darkMode'
const K_AGENT_LOCALE = 'agent.agentLocale'
const K_READ = 'agent.readSeqs'
const K_BACKENDS = 'agent.backends'

export type ThemeMode = 'system' | 'light' | 'dark'

/// The scope the in-memory read watermarks belong to ('' before load).
let readScope = ''

export interface PrefsSnapshot {
  baseUrl: string | null
  token: string | null
  themeMode: ThemeMode
}

export const Prefs = {
  load(): PrefsSnapshot {
    return {
      baseUrl: localStorage.getItem(K_BASE),
      token: localStorage.getItem(K_TOKEN),
      themeMode: Prefs.loadThemeMode(),
    }
  },

  loadThemeMode(): ThemeMode {
    const v = localStorage.getItem(K_THEME)
    if (v === 'system' || v === 'light' || v === 'dark') return v
    const legacy = localStorage.getItem(K_DARK_LEGACY)
    return legacy === '1' ? 'dark' : legacy === '0' ? 'light' : 'system'
  },

  saveThemeMode(m: ThemeMode) {
    localStorage.setItem(K_THEME, m)
  },

  save(base: string, token: string) {
    localStorage.setItem(K_BASE, base)
    localStorage.setItem(K_TOKEN, token)
  },

  loadAgentLocale(): string {
    return localStorage.getItem(K_AGENT_LOCALE) || 'follow'
  },

  saveAgentLocale(v: string) {
    localStorage.setItem(K_AGENT_LOCALE, v)
  },

  /** The effective agent locale pushed to the backend config KV. */
  effectiveAgentLocale(uiZh: boolean): string {
    const v = Prefs.loadAgentLocale()
    if (v === 'follow') return uiZh ? 'zh' : 'en'
    return v
  },

  // ---- read watermarks (localStorage mirror; sqlite is authoritative) ----
  // Keyed per CONNECTION SCOPE (gateway + token): two users / two tenants on
  // the same device must not share unread state.

  loadReadWatermarks(baseUrl: string, token: string): Record<string, number> {
    const scope = baseUrl && token ? scopeOf(baseUrl, token) : ''
    readScope = scope
    if (!scope) return {}
    try {
      return JSON.parse(localStorage.getItem(`${K_READ}.${scope}`) || '{}')
    } catch {
      return {}
    }
  },

  saveReadSeqs(seqs: Record<string, number>) {
    if (!readScope) return
    try {
      localStorage.setItem(`${K_READ}.${readScope}`, JSON.stringify(seqs))
    } catch {
      /* ignore quota */
    }
  },

  clearActive() {
    localStorage.removeItem(K_BASE)
    localStorage.removeItem(K_TOKEN)
  },

  // ---- saved backends ----

  backends(): BackendCfg[] {
    try {
      const list = JSON.parse(localStorage.getItem(K_BACKENDS) || '[]')
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  },

  // The webui is served same-origin with the agent, so a saved account is
  // identified by its TOKEN alone (the base is always this origin).
  upsertBackend(b: BackendCfg) {
    const list = Prefs.backends().filter(x => x.token !== b.token)
    list.unshift(b)
    localStorage.setItem(K_BACKENDS, JSON.stringify(list))
  },

  removeBackend(b: BackendCfg) {
    const list = Prefs.backends().filter(x => x.token !== b.token)
    localStorage.setItem(K_BACKENDS, JSON.stringify(list))
  },
}

export { backendNameFor }
