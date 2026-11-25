// No Shared_Core function throws for bad outside input; it returns a typed error instead
// (Req 1.8, 6.16, 7.5, 7.8).
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): { readonly ok: true; readonly value: T } => ({
  ok: true,
  value,
});
export const err = <E>(
  error: E
): { readonly ok: false; readonly error: E } => ({ ok: false, error });
