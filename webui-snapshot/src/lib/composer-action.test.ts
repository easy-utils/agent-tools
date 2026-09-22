// Composer action-resolution tests — the priority order is the spec.
import { describe, expect, it } from 'vitest'
import { type ComposerState, composerAction } from './composer-action'

const base: ComposerState = {
  awaitingSend: false,
  sending: false,
  canDeliver: false,
  submitting: false,
  canSend: false,
}

describe('composerAction', () => {
  it('awaiting-send wins over everything', () => {
    expect(
      composerAction({
        ...base,
        awaitingSend: true,
        sending: true,
        canDeliver: true,
        submitting: true,
        canSend: true,
      }),
    ).toBe('awaiting-send')
  })

  it('while a turn runs: deliver when there is content, else stop', () => {
    expect(composerAction({ ...base, sending: true, canDeliver: true })).toBe(
      'deliver',
    )
    expect(composerAction({ ...base, sending: true })).toBe('stop')
  })

  it('deliver outranks stop but stop outranks our own submitting', () => {
    expect(composerAction({ ...base, sending: true, submitting: true })).toBe(
      'stop',
    )
  })

  it('idle: submitting spinner, then send, then attach', () => {
    expect(composerAction({ ...base, submitting: true })).toBe('submitting')
    expect(composerAction({ ...base, canSend: true })).toBe('send')
    expect(composerAction(base)).toBe('attach')
  })

  it('submitting is ignored while a turn runs (deliver/stop win)', () => {
    expect(
      composerAction({
        ...base,
        sending: true,
        canDeliver: true,
        submitting: true,
      }),
    ).toBe('deliver')
  })
})
