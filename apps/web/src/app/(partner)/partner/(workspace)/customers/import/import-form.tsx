"use client";
import { useActionState, useRef } from "react";
import { Field, Pill, Select, Table, Td, Th, THead } from "@im/ui";
import { FormMessage, SubmitButton, type FormAction, type FormState } from "@/components/partner/action-form";

type Err = { row: number; message: string };
type Preview = { row: number; name: string; phone?: string; email?: string; policy_number?: string; insurer_name?: string; category_slug?: string; cover_end?: string };
type Outcome = { row: number; name: string; status: "created" | "linked" | "skipped"; detail: string; policyCreated?: boolean };

const parse = <T,>(v: unknown): T[] => {
  if (typeof v !== "string") return [];
  try {
    const x = JSON.parse(v);
    return Array.isArray(x) ? (x as T[]) : [];
  } catch {
    return [];
  }
};

/** CSV upload → preview (validation only) → import. The file is re-sent on import so nothing is held server-side. */
export function ImportForm({ action, managers }: { action: FormAction; managers: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, { ok: false });
  const fileRef = useRef<HTMLInputElement>(null);
  const mode = state.data?.mode;
  const errors = parse<Err>(state.data?.errors);
  const preview = parse<Preview>(state.data?.preview);
  const outcomes = parse<Outcome>(state.data?.outcomes);
  const canImport = state.ok && mode === "preview" && Number(state.data?.valid ?? 0) > 0;

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client list (CSV)" htmlFor="import-file" hint="Columns: name, phone, email, policy_number, insurer_name, category, cover_end · up to 900 KB">
          <input ref={fileRef} id="import-file" name="file" type="file" accept=".csv,text/csv" required className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-[10px] file:border-0 file:bg-mint file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-deep" />
        </Field>
        <Field label="Account manager" htmlFor="import-manager" hint="Assigned to every imported client (you can change it per customer later).">
          <Select id="import-manager" name="accountManagerId" defaultValue="">
            <option value="">No account manager yet</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton name="mode" value="preview" variant="secondary" size="sm" disabled={pending}>Check file</SubmitButton>
        <SubmitButton name="mode" value="import" variant="primary" size="sm" disabled={pending || !canImport} title={canImport ? undefined : "Check the file first"}>
          Import {canImport ? `${state.data?.valid} client${Number(state.data?.valid) === 1 ? "" : "s"}` : ""}
        </SubmitButton>
        <span className="text-xs text-muted">Each client receives an invitation to Covva; those you give an email get a sign-in link, phone-only clients sign in by OTP.</span>
      </div>
      <FormMessage state={state} />

      {errors.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-ink">Rows with problems ({errors.length})</p>
          <Table>
            <THead><tr><Th>Row</Th><Th>Problem</Th></tr></THead>
            <tbody>{errors.slice(0, 200).map((e) => <tr key={e.row}><Td className="tabular-nums">{e.row}</Td><Td className="text-danger">{e.message}</Td></tr>)}</tbody>
          </Table>
        </div>
      )}

      {mode === "preview" && preview.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-ink">Ready to import ({state.data?.valid})</p>
          <Table>
            <THead><tr><Th>Row</Th><Th>Name</Th><Th>Contact</Th><Th>Policy</Th><Th>Cover ends</Th></tr></THead>
            <tbody>
              {preview.map((r) => (
                <tr key={r.row}>
                  <Td className="tabular-nums">{r.row}</Td>
                  <Td className="font-medium text-ink">{r.name}</Td>
                  <Td className="text-xs text-muted">{[r.email, r.phone].filter(Boolean).join(" · ")}</Td>
                  <Td className="text-xs">{r.policy_number ? `${r.policy_number} · ${r.insurer_name} · ${r.category_slug}` : "—"}</Td>
                  <Td className="text-xs">{r.cover_end ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {mode === "import" && outcomes.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-ink">Import report</p>
          <Table>
            <THead><tr><Th>Row</Th><Th>Name</Th><Th>Result</Th><Th>Detail</Th></tr></THead>
            <tbody>
              {outcomes.map((o) => (
                <tr key={o.row}>
                  <Td className="tabular-nums">{o.row}</Td>
                  <Td className="font-medium text-ink">{o.name}</Td>
                  <Td><Pill tone={o.status === "created" ? "ok" : o.status === "linked" ? "info" : "danger"}>{o.status}</Pill>{o.policyCreated && <Pill tone="ok" className="ml-1">policy</Pill>}</Td>
                  <Td className="text-xs text-muted">{o.detail}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </form>
  );
}
