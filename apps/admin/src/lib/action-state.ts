/** Result shape returned by every admin Server Action (consumed by useActionState). */
export type ActionState = {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** Optional payload (e.g. simulation results). */
  data?: unknown;
} | null;
