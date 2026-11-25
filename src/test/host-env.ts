// Test-only host switches for the environment-independence properties (Req 1.7, 6.2).
import { expect, vi } from 'vitest';

export interface HostEnv {
  readonly tz: string;
  readonly offsetMinutes: number | null;
  readonly locale: string;
  readonly clockMs: number;
  readonly random: number;
}

export const ENVS: readonly HostEnv[] = [
  {
    tz: 'Etc/GMT+12',
    offsetMinutes: 720,
    locale: 'tr-TR',
    clockMs: 0,
    random: 0,
  }, // UTC-12:00
  {
    tz: 'Pacific/Kiritimati',
    offsetMinutes: -840,
    locale: 'ar-SA',
    clockMs: 4_102_444_799_999,
    random: 0.999_999,
  }, // UTC+14:00
  {
    tz: 'America/St_Johns',
    offsetMinutes: null,
    locale: 'hi-IN',
    clockMs: 1_800_000_000_000,
    random: 0.5,
  },
];

const savedTz = process.env.TZ;
const realRandom = Math.random;
const intlKeys = ['DateTimeFormat', 'NumberFormat', 'Collator'] as const;
const realIntl = Object.fromEntries(intlKeys.map((k) => [k, Intl[k]]));
const realUpper = String.prototype.toLocaleUpperCase;
const realLower = String.prototype.toLocaleLowerCase;

export function restoreHost(): void {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
  Math.random = realRandom;
  for (const k of intlKeys)
    Object.defineProperty(Intl, k, {
      value: realIntl[k],
      configurable: true,
      writable: true,
    });
  Object.defineProperty(String.prototype, 'toLocaleUpperCase', {
    value: realUpper,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(String.prototype, 'toLocaleLowerCase', {
    value: realLower,
    configurable: true,
    writable: true,
  });
  vi.useRealTimers();
}

/** Switch time zone, clock, default locale and Math.random, and prove each switch took effect. */
export function enterHost(env: HostEnv): void {
  process.env.TZ = env.tz;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(env.clockMs);
  Math.random = () => env.random;
  for (const k of intlKeys) {
    const Real = realIntl[k] as new (l?: unknown, o?: unknown) => object;
    const Wrapped = function (l?: unknown, o?: unknown) {
      return new Real(l ?? env.locale, o);
    };
    Object.defineProperty(Intl, k, {
      value: Wrapped,
      configurable: true,
      writable: true,
    });
  }
  Object.defineProperty(String.prototype, 'toLocaleUpperCase', {
    value(this: string, l?: string) {
      return realUpper.call(this, l ?? env.locale);
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(String.prototype, 'toLocaleLowerCase', {
    value(this: string, l?: string) {
      return realLower.call(this, l ?? env.locale);
    },
    configurable: true,
    writable: true,
  });
  expect(Date.now()).toBe(env.clockMs);
  expect(Math.random()).toBe(env.random);
  expect(new Intl.NumberFormat().resolvedOptions().locale).toBe(env.locale);
  if (env.offsetMinutes !== null)
    expect(new Date(env.clockMs).getTimezoneOffset()).toBe(env.offsetMinutes);
}
