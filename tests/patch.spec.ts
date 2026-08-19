import { describe, expect, it } from 'vitest'
import { applyUnifiedDiffToText, normalizePatchHunkCounts } from '../src/backends/patch.js'

describe('normalizePatchHunkCounts', () => {
  it('repairs every hunk count while preserving paths and content', () => {
    const patch = [
      '--- a/kernel.cu',
      '+++ b/kernel.cu',
      '@@ -2,99 +2,77 @@',
      ' context',
      '-old',
      '+new',
      '+extra',
      '@@ -10,8 +11,3 @@ tail',
      '-removed',
      ' kept',
      '+added',
      '',
    ].join('\n')

    expect(normalizePatchHunkCounts(patch)).toBe([
      '--- a/kernel.cu',
      '+++ b/kernel.cu',
      '@@ -2,2 +2,3 @@',
      ' context',
      '-old',
      '+new',
      '+extra',
      '@@ -10,2 +11,2 @@ tail',
      '-removed',
      ' kept',
      '+added',
      '',
    ].join('\n'))
  })

  it('applies multiple exact-context hunks independent of declared counts and CRLF', () => {
    const source = 'zero\r\none\r\ntwo\r\nthree\r\nfour\r\n'
    const patch = [
      '--- a/kernel.cu', '+++ b/kernel.cu',
      '@@ -2,99 +2,99 @@', ' one', '-two', '+TWO',
      '@@ -5,88 +5,77 @@', '-four', '+FOUR', '',
    ].join('\n')
    expect(applyUnifiedDiffToText(source, normalizePatchHunkCounts(patch), 'kernel.cu')).toBe('zero\r\none\r\nTWO\r\nthree\r\nFOUR\r\n')
  })

  it('rejects ambiguous old context', () => {
    const patch = ['--- a/kernel.cu', '+++ b/kernel.cu', '@@ -8,1 +8,1 @@', '-same', '+changed', ''].join('\n')
    expect(() => applyUnifiedDiffToText('same\nsame\n', normalizePatchHunkCounts(patch), 'kernel.cu')).toThrow(/matched 2 locations/)
  })
})
