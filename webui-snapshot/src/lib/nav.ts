// Per-tab navigation stacks — pure array operations behind AppStore's
// pushPage/pushSibling/popPage. Kept separate (and tested) so the reset/pop
// rules are explicit: same-key pages replace at their depth, a sibling drill-in
// keeps the stack at [root, current], and popping never goes below the root.
export type SiderTab = 'chat' | 'config'
export type SessionOverlay = 'mailbox'

export type AppPage =
  | { kind: 'chat_list'; key: 'chat_list' }
  | { kind: 'chat_session'; key: 'chat_session' }
  | { kind: 'chat_overlay'; key: 'chat_overlay'; overlay: SessionOverlay }
  | { kind: 'config_root'; key: 'config_root' }
  | { kind: 'config_sub'; key: string; id: string }
  | { kind: 'providers_list'; key: 'providers_list' }
  | { kind: 'preset_form'; key: 'preset_form_new' }
  | { kind: 'provider_form'; key: 'provider_form' }
  | { kind: 'provider_models'; key: string; modelId: string | null }

export function rootPageFor(tab: SiderTab): AppPage {
  return tab === 'chat'
    ? { kind: 'chat_list', key: 'chat_list' }
    : { kind: 'config_root', key: 'config_root' }
}

/** Push a page; a same-key page replaces at (and truncates from) its depth. */
export function pushPage(stack: AppPage[], page: AppPage): AppPage[] {
  const list = [...stack]
  const idx = list.findIndex(p => p.key === page.key)
  if (idx !== -1) list.splice(idx, list.length - idx)
  list.push(page)
  return list
}

/** Push a SIBLING drill-in: replaces the current drill-in, keeping the stack
 *  at [root, current] so the tablet split never shows two parallels. */
export function pushSibling(stack: AppPage[], page: AppPage): AppPage[] {
  const list = stack.length > 1 ? stack.slice(0, 1) : [...stack]
  return pushPage(list, page)
}

/** Pop the top page; never pops below the root. */
export function popPage(stack: AppPage[]): AppPage[] {
  return stack.length > 1 ? stack.slice(0, -1) : [...stack]
}
