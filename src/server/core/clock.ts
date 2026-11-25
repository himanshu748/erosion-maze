export type Clock = () => number;

export const systemClock: Clock = () => Date.now();

export const fixedClock =
  (ms: number): Clock =>
  () =>
    ms;
