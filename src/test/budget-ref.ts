// Independent Move_Budget reference for Req 4.1 and 4.7: SLACK as the decimal strings of the
// requirements' default table, multiplied out in BigInt.
import type { Weekday } from '../shared/date';

export const SLACK_TEXT = [
  '0.60',
  '0.50',
  '0.40',
  '0.32',
  '0.25',
  '0.18',
  '0.12',
] as const;

export function budgetFor(par: number, w: Weekday): number {
  const [whole, frac = ''] = SLACK_TEXT[w].split('.');
  const scale = 10n ** BigInt(frac.length);
  const num =
    BigInt(par) * (BigInt(whole ?? '0') * scale + BigInt(frac || '0'));
  const ceil = num / scale + (num % scale === 0n ? 0n : 1n);
  return par + Number(ceil);
}
