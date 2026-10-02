import { describe, expect, it } from 'vitest'
import { BOM } from '../../../lib/csv.js'
import { batchRange, batchToCSV, batchTotals, convertBatch, parseBatch, parseBatchDate } from './batch.js'

describe('parseBatchDate', () => {
  it('lee AAAA-MM-DD y DD/MM/AAAA y rechaza fechas que no existen', () => {
    expect(parseBatchDate('2026-10-05')).toBe('2026-10-05')
    expect(parseBatchDate('5/10/2026')).toBe('2026-10-05')
    expect(parseBatchDate('31/02/2026')).toBeNull()
    expect(parseBatchDate('ayer')).toBeNull()
  })
})

describe('parseBatch', () => {
  it('con encabezado fecha,monto y montos con miles', () => {
    const { rows, errors } = parseBatch('fecha,monto\n2026-10-05,"1,000"\n2026-09-30,250.5\n')
    expect(errors).toEqual([])
    expect(rows).toEqual([
      { line: 2, date: '2026-10-05', amountUsd: 1000 },
      { line: 3, date: '2026-09-30', amountUsd: 250.5 },
    ])
  })

  it('sin encabezado, con punto y coma y coma decimal', () => {
    const { rows } = parseBatch('05/10/2026;1.000,25\n')
    expect(rows).toEqual([{ line: 1, date: '2026-10-05', amountUsd: 1000.25 }])
  })

  it('reporta el renglón que no se entiende y sigue con los demás', () => {
    const { rows, errors } = parseBatch('fecha,monto\nmañana,10\n2026-10-01,abc\n2026-10-02,5\n')
    expect(rows).toHaveLength(1)
    expect(errors.map((e) => e.line)).toEqual([2, 3])
  })
})

describe('batchRange', () => {
  it('da la fecha mínima y máxima y avisa si pasa de 3 años', () => {
    const rows = [
      { line: 2, date: '2026-10-05', amountUsd: 1 },
      { line: 3, date: '2026-01-15', amountUsd: 1 },
    ]
    expect(batchRange(rows)).toEqual({ start: '2026-01-15', end: '2026-10-05', days: 263, tooLong: false })
    expect(batchRange([{ line: 1, date: '2020-01-01', amountUsd: 1 }, { line: 2, date: '2026-01-01', amountUsd: 1 }])?.tooLong).toBe(true)
    expect(batchRange([])).toBeNull()
  })
})

describe('convertBatch', () => {
  it('caso de la spec: 1,000 USD el 2026-10-05 con regla del DOF y FIX del 2026-10-01 de 18.30 dan 18,300.00 MXN', () => {
    const rows = [{ line: 2, date: '2026-10-05', amountUsd: 1000 }]
    const fixRows = [
      { date: '2026-10-04', fixDate: '2026-10-01', value: 18.3 },
      { date: '2026-10-05', fixDate: '2026-10-01', value: 18.3 },
    ]
    const [out] = convertBatch(rows, fixRows)
    expect(out).toEqual({ line: 2, date: '2026-10-05', amountUsd: 1000, fixDate: '2026-10-01', rate: 18.3, amountMxn: 18300 })
    expect(batchToCSV([out])).toBe(`${BOM}fecha,monto_usd,fix_fecha,tipo_de_cambio,monto_mxn\r\n2026-10-05,1000.00,2026-10-01,18.3000,18300.00\r\n`)
  })

  it('sin fila de esa fecha o con value null queda s/d, nunca 0', () => {
    const rows = [
      { line: 2, date: '2026-10-05', amountUsd: 10 },
      { line: 3, date: '2026-12-01', amountUsd: 20 },
    ]
    const out = convertBatch(rows, [{ date: '2026-10-05', fixDate: null, value: null }])
    expect(out.map((r) => r.amountMxn)).toEqual([null, null])
    expect(batchTotals(out)).toEqual({ usd: 30, mxn: 0, missing: 2, count: 2 })
    expect(batchToCSV(out)).toContain('2026-10-05,10.00,s/d,s/d,s/d')
  })
})
