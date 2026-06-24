/** CSV and Excel (SpreadsheetML) exporters for journal entries. */
import type { JournalEntry } from '@/types';
import { fmtDateTime } from '@/utils/time';

const COLUMNS: { key: string; label: string; get: (e: JournalEntry) => string | number }[] = [
  { key: 'symbol', label: 'Symbol', get: (e) => e.symbol },
  { key: 'side', label: 'Direction', get: (e) => e.side },
  { key: 'entryTime', label: 'Entry Time', get: (e) => fmtDateTime(e.entryTime) },
  { key: 'exitTime', label: 'Exit Time', get: (e) => fmtDateTime(e.exitTime) },
  { key: 'entryPrice', label: 'Entry', get: (e) => e.entryPrice },
  { key: 'exitPrice', label: 'Exit', get: (e) => e.exitPrice },
  { key: 'quantity', label: 'Qty', get: (e) => e.quantity.toFixed(4) },
  { key: 'pnl', label: 'P/L', get: (e) => e.pnl.toFixed(2) },
  { key: 'rr', label: 'R', get: (e) => e.rr.toFixed(2) },
  { key: 'riskAmount', label: 'Risk', get: (e) => e.riskAmount.toFixed(2) },
  { key: 'notes', label: 'Notes', get: (e) => e.notes ?? '' },
];

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCSV(entries: JournalEntry[]) {
  const header = COLUMNS.map((c) => c.label).join(',');
  const rows = entries.map((e) => COLUMNS.map((c) => csvEscape(c.get(e))).join(','));
  download(`journal_${Date.now()}.csv`, [header, ...rows].join('\n'), 'text/csv;charset=utf-8');
}

/** Excel-compatible XML spreadsheet (opens natively in Excel, no deps). */
export function exportExcel(entries: JournalEntry[]) {
  const xmlEscape = (v: string | number) =>
    String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cell = (v: string | number, type: 'String' | 'Number') =>
    `<Cell><Data ss:Type="${type}">${xmlEscape(v)}</Data></Cell>`;
  const headerRow = `<Row>${COLUMNS.map((c) => cell(c.label, 'String')).join('')}</Row>`;
  const bodyRows = entries
    .map(
      (e) =>
        `<Row>${COLUMNS.map((c) => {
          const v = c.get(e);
          return cell(v, typeof v === 'number' ? 'Number' : 'String');
        }).join('')}</Row>`,
    )
    .join('');

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Journal"><Table>${headerRow}${bodyRows}</Table></Worksheet>
</Workbook>`;
  download(`journal_${Date.now()}.xls`, xml, 'application/vnd.ms-excel');
}
