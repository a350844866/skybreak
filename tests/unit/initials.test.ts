import { expect, it } from 'vitest';
import { filterInitials, rotateLetter } from '../../src/game/initials';

it('normalizes valid initials and rejects blocked or malformed combinations', () => {
  expect(filterInitials('aaa')).toBe('AAA');
  expect(filterInitials('sKy')).toBe('SKY');
  for (const value of ['AsS', 'KKK', '<b>', 'AB1', 'AB', 'ABCD']) {
    expect(filterInitials(value)).toBeNull();
  }
});

it('wraps the letter wheels in both directions', () => {
  expect(rotateLetter('A', -1)).toBe('Z');
  expect(rotateLetter('Z', 1)).toBe('A');
  expect(rotateLetter('E', 1)).toBe('F');
});
