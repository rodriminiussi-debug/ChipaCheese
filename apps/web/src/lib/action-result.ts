export type ActionResult<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
