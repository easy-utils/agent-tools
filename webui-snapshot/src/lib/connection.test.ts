// Connection-state tests — the banner is driven by either long-lived stream.
import { beforeEach, describe, expect, it } from 'vitest'
import { connection, isReconnecting } from './connection.svelte'

beforeEach(() => {
  connection.sessions = false
  connection.chat = false
})

describe('isReconnecting', () => {
  it('is false when both streams are up', () => {
    expect(isReconnecting()).toBe(false)
  })

  it('is true when either stream is down', () => {
    connection.sessions = true
    expect(isReconnecting()).toBe(true)
    connection.sessions = false
    connection.chat = true
    expect(isReconnecting()).toBe(true)
  })

  it('only clears when BOTH are back up', () => {
    connection.sessions = true
    connection.chat = true
    connection.chat = false
    expect(isReconnecting()).toBe(true)
    connection.sessions = false
    expect(isReconnecting()).toBe(false)
  })
})
