// Download rows as a CSV file (opens in Excel). columns = [{ label, value(row) }]
const cell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  // A cell starting with = + - @ would run as a formula when opened in Excel; neutralise it.
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export function downloadCsv(filename, rows, columns) {
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  rows.forEach((r) => lines.push(columns.map((c) => cell(c.value(r))).join(',')));
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
