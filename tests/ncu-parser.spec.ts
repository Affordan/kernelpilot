import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parseNcuCsv } from '../src/ncu/parser.js'

describe('parseNcuCsv', () => {
  it('finds metrics by semantic name and reports missing values', async () => {
    const fixture = await readFile(new URL('./fixtures/ncu.csv', import.meta.url), 'utf8')
    const observation = parseNcuCsv(fixture, 'reduce_sum', 'report.ncu-rep')
    expect(observation.durationMs).toBeCloseTo(0.1832)
    expect(observation.dramThroughputPct).toBe(81.2)
    expect(observation.occupancyPct).toBe(62.5)
    expect(observation.warpStalls).toHaveProperty('smsp__warp_issue_stalled_long_scoreboard_per_warp_active.pct', 38.4)
    expect(observation.missingMetrics).toContain('l1ThroughputPct')
  })
})

