import { writeFileSync } from 'fs'

function escapeCsvCell(v: string | number): string {
  const s = String(v)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function exportCsv(
  filePath: string,
  fields: Array<{ field_name: string }>,
  rows: Record<string, string | number>[]
): void {
  const headers = fields.map((f) => f.field_name)
  const lines = [headers.map(escapeCsvCell).join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h] ?? '')).join(','))
  }
  writeFileSync(filePath, '\uFEFF' + lines.join('\r\n'), 'utf8')
}
