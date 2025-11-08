export function normalizeCNJ(value: string | number | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const digits = String(value).replace(/\D+/g, "");
  if (digits.length !== 20) return null;
  return `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16)}`;
}

export default {
  normalizeCNJ,
};