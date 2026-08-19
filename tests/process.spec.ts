import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveInside } from '../src/backends/process.js'

describe('resolveInside', () => {
  it('accepts descendants and rejects traversal', () => {
    const root = path.resolve('workspace')
    expect(resolveInside(root, 'src/kernel.cu')).toBe(path.join(root, 'src', 'kernel.cu'))
    expect(() => resolveInside(root, '../other')).toThrow(/escapes workspace/)
  })
})

