"use client";
import { useActionState, useRef } from "react";
import { Field, Table, Td, Th, THead } from "@im/ui";
import { FormMessage, SubmitButton, type FormAction, type FormState } from "@/components/partner/action-form";

type Err = { row: number; message: string };
const parse = <T,>(v: unknown): T[] => {
  if (typeof v !== "string") return [];
  try {
    const x = JSON.parse(v);
    return Array.isArray(x) ? (x as T[]) : [];
  } catch {
    return [];
  }
};

/**
 * CSV upload → preview (validation only, row-numbered problems) → import. The file is re-sent on import so nothing
 * is held server-side between the two steps.
 */
export function CsvImportForm({
  action,
  hidden,
  label,
  hint,
  columns,
  noun,
  templateHref,
  templateName,
}: {
  action: FormAction;
  hidden: Record<string, string>;
  label: string;
  hint: string;
  columns: { key: string; label: string }[];
  noun: string;
  templateHref: string;
  templateName: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, { ok: false });
  const fileRef = useRef<HTMLInputElement>(null);
  const mode = state.data?.mode;
  const errors = parse<Err>(state.data?.errors);
  const preview = parse<Record<string, unknown>>(state.data?.preview);
  const valid = Number(state.data?.valid ?? 0);
  const canImport = state.ok && mode === "preview" && valid > 0;
  return (
    <form action={formAction} className="space-y-4" aria-label={`${label} upload`}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Field label={label} htmlFor={`csv-${noun}`} hint={hint}>
        <input ref={fileRef} id={`csv-${noun}`} name="file" type="file" accept=".csv,text/csv" required className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-[10px] file:border-0 file:bg-mint file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-deep" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton name="mode" value="preview" variant="secondary" size="sm" disabled={pending}>Check file</SubmitButton>
        <SubmitButton name="mode" value="import" variant="primary" size="sm" disabled={pending || !canImport} title={canImport ? undefined : "Check the file first"}>
          Import {canImport ? `${valid} ${noun}${valid === 1 ? "" : "s"}` : ""}
        </SubmitButton>
        <a href={templateHref} download={templateName} className="text-sm font-medium text-brand hover:underline">Download the CSV template</a>
      </div>
      <FormMessage state={state} />
      {errors.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-ink">Rows with problems ({errors.length})</p>
          <Table>
            <THead><tr><Th>Row</Th><Th>Problem</Th></tr></THead>
            <tbody>{errors.slice(0, 300).map((e, i) => <tr key={`${e.row}-${i}`}><Td className="tabular-nums">{e.row}</Td><Td className="text-danger">{e.message}</Td></tr>)}</tbody>
          </Table>
        </div>
      )}
      {mode === "preview" && preview.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-ink">Ready to import ({valid})</p>
          <Table>
            <THead><tr><Th>Row</Th>{columns.map((c) => <Th key={c.key}>{c.label}</Th>)}</tr></THead>
            <tbody>
              {preview.map((r) => (
                <tr key={String(r.row)}>
                  <Td className="tabular-nums">{String(r.row)}</Td>
                  {columns.map((c) => <Td key={c.key} className="text-sm">{r[c.key] === undefined || r[c.key] === null || r[c.key] === "" ? "—" : String(r[c.key])}</Td>)}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </form>
  );
}
