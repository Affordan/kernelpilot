import type { ProfilerObservation } from '../domain/schema.js'

interface MetricRow {
  readonly name: string
  readonly value: number
  readonly unit: string
}

const aliases: Readonly<Record<string, readonly string[]>> = {
  durationMs: ['gpu__time_duration.sum', 'gpu__time_duration.avg'],
  dramThroughputPct: ['gpu__dram_throughput.avg.pct_of_peak_sustained_elapsed'],
  l1ThroughputPct: ['l1tex__throughput.avg.pct_of_peak_sustained_elapsed'],
  l2ThroughputPct: ['lts__throughput.avg.pct_of_peak_sustained_elapsed'],
  occupancyPct: ['sm__warps_active.avg.pct_of_peak_sustained_active'],
  registersPerThread: ['launch__registers_per_thread'],
  sharedMemoryBytes: ['launch__shared_mem_per_block', 'launch__shared_mem_per_block_allocated'],
}

/** Parse long- or wide-form NCU CSV by metric names and tolerate optional metrics. */
export function parseNcuCsv(text: string, kernelName: string, rawReportPath?: string): ProfilerObservation {
  const records = parseCsv(text)
  const rows = metricRows(records, kernelName)
  if (rows.length === 0) throw new Error('NCU CSV does not contain readable metric rows')
  const metrics = new Map(rows.map(row => [row.name, row]))
  const missingMetrics: string[] = []
  const read = (field: keyof typeof aliases): MetricRow | undefined => {
    const row = aliases[field]?.map(name => metrics.get(name)).find(value => value !== undefined)
    if (row === undefined) missingMetrics.push(field)
    return row
  }
  const duration = read('durationMs')
  const dram = read('dramThroughputPct')
  const l1 = read('l1ThroughputPct')
  const l2 = read('l2ThroughputPct')
  const occupancy = read('occupancyPct')
  const registers = read('registersPerThread')
  const shared = read('sharedMemoryBytes')
  const warpStalls = Object.fromEntries(rows.filter(row => row.name.startsWith('smsp__warp_issue_stalled_')).map(row => [row.name, row.value]))
  return {
    kernelName,
    ...(duration === undefined ? {} : { durationMs: durationToMs(duration.value, duration.unit) }),
    ...(dram === undefined ? {} : { dramThroughputPct: dram.value }),
    ...(l1 === undefined ? {} : { l1ThroughputPct: l1.value }),
    ...(l2 === undefined ? {} : { l2ThroughputPct: l2.value }),
    ...(occupancy === undefined ? {} : { occupancyPct: occupancy.value }),
    ...(registers === undefined ? {} : { registersPerThread: registers.value }),
    ...(shared === undefined ? {} : { sharedMemoryBytes: bytes(shared.value, shared.unit) }),
    warpStalls,
    launch: {},
    ...(rawReportPath === undefined ? {} : { rawReportPath }),
    missingMetrics,
  }
}

function metricRows(records: readonly string[][], kernelName: string): MetricRow[] {
  const longHeaderIndex = records.findIndex(row => row.some(cell => cell.trim() === 'Metric Name'))
  if (longHeaderIndex >= 0) return longMetricRows(records, longHeaderIndex, kernelName)
  return wideMetricRows(records, kernelName)
}

function longMetricRows(records: readonly string[][], headerIndex: number, kernelName: string): MetricRow[] {
  const header = records[headerIndex] ?? []
  const nameIndex = header.findIndex(cell => cell.trim() === 'Metric Name')
  const valueIndex = header.findIndex(cell => cell.trim() === 'Metric Value')
  const unitIndex = header.findIndex(cell => cell.trim() === 'Metric Unit')
  const kernelIndex = header.findIndex(cell => cell.trim() === 'Kernel Name')
  if (nameIndex < 0 || valueIndex < 0) throw new Error('NCU CSV lacks required metric columns')
  return records.slice(headerIndex + 1).flatMap(row => {
    if (kernelIndex >= 0 && !matchesKernel(row[kernelIndex], kernelName)) return []
    const name = row[nameIndex]?.trim()
    const rawValue = row[valueIndex]?.replaceAll(',', '').trim()
    if (name === undefined || rawValue === undefined || name === '') return []
    const value = Number(rawValue)
    return Number.isFinite(value) ? [{ name, value, unit: row[unitIndex]?.trim() ?? '' }] : []
  })
}

function wideMetricRows(records: readonly string[][], kernelName: string): MetricRow[] {
  const headerIndex = records.findIndex(row => row.some(cell => cell.trim() === 'Kernel Name') && row.some(cell => isMetricName(cell.trim())))
  if (headerIndex < 0) return []
  const header = records[headerIndex] ?? []
  const units = records[headerIndex + 1] ?? []
  const kernelIndex = header.findIndex(cell => cell.trim() === 'Kernel Name')
  const data = records.slice(headerIndex + 2).filter(row => kernelIndex < 0 || matchesKernel(row[kernelIndex], kernelName))
  return header.flatMap((cell, index) => {
    const name = cell.trim()
    if (!isMetricName(name)) return []
    const values = data.map(row => numeric(row[index])).filter((value): value is number => value !== undefined)
    if (values.length === 0) return []
    return [{ name, value: values.reduce((sum, value) => sum + value, 0) / values.length, unit: units[index]?.trim() ?? '' }]
  })
}

function isMetricName(name: string): boolean {
  return Object.values(aliases).some(names => names.includes(name)) || name.startsWith('smsp__warp_issue_stalled_')
}

function matchesKernel(value: string | undefined, kernelName: string): boolean {
  return value === undefined || value.trim().includes(kernelName)
}

function numeric(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value.replaceAll(',', '').trim())
  return Number.isFinite(parsed) ? parsed : undefined
}

function durationToMs(value: number, unit: string): number {
  if (unit === 'ns') return value / 1e6
  if (unit === 'us' || unit === 'µs') return value / 1e3
  if (unit === 's') return value * 1e3
  return value
}

function bytes(value: number, unit: string): number {
  if (unit === 'Kbyte') return value * 1024
  if (unit === 'Mbyte') return value * 1024 * 1024
  return value
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? ''
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1 } else quoted = !quoted
    } else if (character === ',' && !quoted) {
      row.push(cell); cell = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell); cell = ''
      if (row.some(value => value.length > 0)) rows.push(row)
      row = []
    } else {
      cell += character
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}
