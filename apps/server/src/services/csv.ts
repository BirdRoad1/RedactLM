// A CSV cell: quoted when needed, and made safe to open in a spreadsheet.
// Text starting with = + - @ (or a tab or carriage return) would run as a
// formula in Excel and friends; some cells hold text outsiders typed (the
// email on a failed login), so those get a leading apostrophe.
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvRow = (cells: unknown[]) => cells.map(csvCell).join(",") + "\r\n";
