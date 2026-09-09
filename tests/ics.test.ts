import { describe, expect, it } from 'vitest'
import { buildIcs, escapeIcsText } from '../api/_lib/ics'

describe('escapeIcsText', () => {
  it('escapa vírgulas, pontos e vírgulas, barras e quebras de linha', () => {
    expect(escapeIcsText('Bike, 45 min; leve\nnota')).toBe('Bike\\, 45 min\\; leve\\nnota')
  })
})

describe('buildIcs', () => {
  it('gera um calendário válido com eventos de dia inteiro', () => {
    const ics = buildIcs(
      [
        { uid: 's1@regresso', date: '2026-09-14', summary: 'Bike 45 min @ 140 W' },
        { uid: 's2@regresso', date: '2026-09-16', summary: 'Força A', description: 'RDL, Hip thrust' },
      ],
      'A Época do Regresso',
      new Date('2026-09-10T12:00:00Z'),
    )
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('X-WR-CALNAME:A Época do Regresso')
    expect(ics).toContain('DTSTART;VALUE=DATE:20260914')
    expect(ics).toContain('SUMMARY:Bike 45 min @ 140 W')
    expect(ics).toContain('DESCRIPTION:RDL\\, Hip thrust')
    expect(ics).toContain('DTSTAMP:20260910T120000Z')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    // linhas separadas por CRLF
    expect(ics.split('\r\n')).toContain('BEGIN:VEVENT')
  })
})
