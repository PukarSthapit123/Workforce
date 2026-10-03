/* A real file for the person to save, built in the browser: the prototype's
   csv() and download() (qnipay-workforce-v15.html). Nothing is sent anywhere. */

/* One CSV line per row. A cell with a comma, a quote or a line break is quoted, and its quotes doubled. */
export function toCsv(rows: readonly (readonly (string | number)[])[]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map(r => r.map(cell).join(',')).join('\r\n');
}

/* Saves `text` as `name`. False when the browser cannot produce a file, so
   the screen can say that nothing was saved. */
export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8'): boolean {
  if (typeof URL.createObjectURL !== 'function') return false;
  try {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}
