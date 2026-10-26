/** "31-01-2024" -> "2024-01-31" (the format <input type="date"> uses). */
export function ddmmyyyyToInput(value) {
  const parts = String(value ?? '').split(/[-/]/);
  if (parts.length !== 3) return '';
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return '';
  return `${yyyy.padStart(4, '0')}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

/** "2024-01-31" -> "31-01-2024" (the format the API and the court site use); '' -> null. */
export function inputToDdmmyyyy(value) {
  if (!value) return null;
  const [yyyy, mm, dd] = value.split('-');
  return `${dd}-${mm}-${yyyy}`;
}
