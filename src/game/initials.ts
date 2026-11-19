const blocked = new Set(['ASS', 'CUM', 'FAG', 'FUK', 'KKK', 'NIG', 'SEX']);

export function filterInitials(value: string): string | null {
  const letters = value.toUpperCase();
  return /^[A-Z]{3}$/.test(letters) && !blocked.has(letters) ? letters : null;
}

export function rotateLetter(letter: string, step: -1 | 1): string {
  return String.fromCharCode(65 + (letter.charCodeAt(0) - 65 + step + 26) % 26);
}
