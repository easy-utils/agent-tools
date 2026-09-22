// Navigation-stack tests — the push/replace/sibling/pop rules.
import { describe, expect, it } from 'vitest'
import {
  type AppPage,
  popPage,
  pushPage,
  pushSibling,
  rootPageFor,
} from './nav'

const root = rootPageFor('chat')
const session: AppPage = { kind: 'chat_session', key: 'chat_session' }

describe('rootPageFor', () => {
  it('maps each tab to its root', () => {
    expect(rootPageFor('chat')).toEqual({ kind: 'chat_list', key: 'chat_list' })
    expect(rootPageFor('config')).toEqual({
      kind: 'config_root',
      key: 'config_root',
    })
  })
})

describe('pushPage', () => {
  it('appends a new page', () => {
    expect(pushPage([root], session)).toEqual([root, session])
  })

  it('replaces at the depth of a same-key page (truncating deeper pages)', () => {
    const a: AppPage = { kind: 'config_sub', key: 'sub', id: 'a' }
    const b: AppPage = { kind: 'config_sub', key: 'sub', id: 'b' }
    const stack = [root, a]
    expect(pushPage(stack, b)).toEqual([root, b])
  })

  it('does not mutate the input', () => {
    const stack = [root]
    pushPage(stack, session)
    expect(stack).toEqual([root])
  })
})

describe('pushSibling', () => {
  it('keeps the stack at [root, current] then pushes the sibling', () => {
    const a: AppPage = { kind: 'config_sub', key: 'a', id: 'a' }
    const b: AppPage = { kind: 'config_sub', key: 'b', id: 'b' }
    const stack: AppPage[] = [
      root,
      a,
      { kind: 'preset_form', key: 'preset_form_new' },
    ]
    expect(pushSibling(stack, b)).toEqual([root, b])
  })

  it('behaves like pushPage from a bare root', () => {
    expect(pushSibling([root], session)).toEqual([root, session])
  })
})

describe('popPage', () => {
  it('pops the top page', () => {
    expect(popPage([root, session])).toEqual([root])
  })

  it('never pops below the root', () => {
    expect(popPage([root])).toEqual([root])
    expect(popPage([])).toEqual([])
  })
})
