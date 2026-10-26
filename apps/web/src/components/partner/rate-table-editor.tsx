"use client";
import { useActionState, useMemo, useRef, useState } from "react";
import { Download, Plus, Upload } from "lucide-react";
import { Button, Field, Input, Notice, Select, Table, Td, Th, THead } from "@im/ui";
import { RATE_KINDS, parseRateTableCsv, rateTableCsvTemplate, type RateRow } from "@im/core";
import { FormMessage, SubmitButton, type FormAction } from "./action-form";

export interface EditableRow { id?: string; factors: Record<string, string>; rate: string; rate_kind: RateRow["rate_kind"]; min_premium: string }

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function TemplateDownload({ factorKeys, name = "rate-table-template.csv" }: { factorKeys: string[]; name?: string }) {
  return (
    <Button type="button" size="sm" variant="secondary" onClick={() => download(name, rateTableCsvTemplate(factorKeys))}>
      <Download className="size-4" /> Download CSV template
    </Button>
  );
}

/**
 * Manual rows editor. Existing rows are updated in place and new rows appended;
 * rows are never deleted (catalogue data is audited), so a wrong row is corrected or
 * the table is replaced by a new CSV import.
 */
export function RateRowsEditor({ action, tableId, factorKeys, initial, locked }: { action: FormAction; tableId: string; factorKeys: string[]; initial: EditableRow[]; locked: boolean }) {
  const [state, formAction] = useActionState(action, { ok: false });
  const blank = (): EditableRow => ({ factors: Object.fromEntries(factorKeys.map((k) => [k, "*"])), rate: "", rate_kind: "rate_on_value", min_premium: "" });
  const [rows, setRows] = useState<EditableRow[]>(initial.length ? initial : [blank()]);
  const update = (i: number, patch: Partial<EditableRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const payload = useMemo(() => JSON.stringify({ tableId, rows: rows.filter((r) => r.rate.trim() !== "") }), [tableId, rows]);
  const problems = rows.map((r, i) => (r.rate.trim() !== "" && (Number.isNaN(Number(r.rate)) || Number(r.rate) < 0) ? `Row ${i + 1}: rate must be a number ≥ 0.` : null)).filter(Boolean) as string[];

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="payload" value={payload} />
      <div className="overflow-x-auto">
        <Table>
          <THead>
            <tr>
              <Th>#</Th>
              {factorKeys.map((k) => <Th key={k}>{k.replace(/_/g, " ")}</Th>)}
              <Th>Rate</Th>
              <Th>Kind</Th>
              <Th>Min premium</Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id ?? `new-${i}`}>
                <Td className="text-xs text-muted">{r.id ? i + 1 : <span title="New row">+</span>}</Td>
                {factorKeys.map((k) => (
                  <Td key={k}>
                    <Input aria-label={`${k} row ${i + 1}`} value={r.factors[k] ?? "*"} disabled={locked} onChange={(e) => update(i, { factors: { ...r.factors, [k]: e.currentTarget.value } })} className="h-9 min-w-28 text-sm" />
                  </Td>
                ))}
                <Td><Input aria-label={`rate row ${i + 1}`} value={r.rate} inputMode="decimal" disabled={locked} placeholder="0.045" onChange={(e) => update(i, { rate: e.currentTarget.value })} className="h-9 w-24 text-sm" /></Td>
                <Td>
                  <Select aria-label={`rate kind row ${i + 1}`} value={r.rate_kind} disabled={locked} onChange={(e) => update(i, { rate_kind: e.currentTarget.value as RateRow["rate_kind"] })} className="h-9 text-sm">
                    {RATE_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
                  </Select>
                </Td>
                <Td><Input aria-label={`minimum premium row ${i + 1}`} value={r.min_premium} inputMode="decimal" disabled={locked} placeholder="—" onChange={(e) => update(i, { min_premium: e.currentTarget.value })} className="h-9 w-24 text-sm" /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <p className="text-xs text-muted">Use <code>*</code> for “any value”. The most specific matching row wins; rate on value is a fraction (0.045 = 4.5%).</p>
      {problems.length > 0 && <Notice tone="danger">{problems.join(" ")}</Notice>}
      {!locked && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, blank()])}><Plus className="size-4" /> Add row</Button>
          <SubmitButton size="sm" disabled={problems.length > 0} pendingLabel="Saving…">Save rows</SubmitButton>
        </div>
      )}
      <FormMessage state={state} />
    </form>
  );
}

/** CSV upload with client-side validation preview; the server re-validates and creates a new table. */
export function CsvImportForm({ action, versionId, defaultFactorKeys }: { action: FormAction; versionId: string; defaultFactorKeys: string[] }) {
  const [state, formAction] = useActionState(action, { ok: false });
  const [keys, setKeys] = useState(defaultFactorKeys.join(", "));
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const factorKeys = useMemo(() => [...new Set(keys.split(/[,\s]+/).map((k) => k.trim()).filter(Boolean))], [keys]);
  const preview = useMemo(() => (csv ? parseRateTableCsv(csv, factorKeys) : null), [csv, factorKeys]);
  const blocking = preview?.errors.filter((e) => e.row > 1 || /Missing column|empty/.test(e.message)) ?? [];

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="csv" value={csv} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Table name" htmlFor="csv-name"><Input id="csv-name" name="name" required placeholder="Motor private rates 2027" className="h-10 text-sm" /></Field>
        <Field label="Factor keys (columns, comma-separated)" htmlFor="csv-keys" hint="Must match risk fields, e.g. vehicle_use, vehicle_age_band, region">
          <Input id="csv-keys" name="factorKeys" value={keys} onChange={(e) => setKeys(e.currentTarget.value)} required className="h-10 text-sm" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <TemplateDownload factorKeys={factorKeys} />
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-mist">
          <Upload className="size-4" /> {fileName ?? "Choose CSV file"}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const f = e.currentTarget.files?.[0];
              if (!f) return;
              setFileName(f.name);
              setCsv(await f.text());
            }}
          />
        </label>
      </div>
      {preview && (
        <div className="rounded-lg border border-line p-3 text-sm">
          <p className="font-semibold text-ink">{preview.rows.length} valid row{preview.rows.length === 1 ? "" : "s"} · {preview.errors.length} issue{preview.errors.length === 1 ? "" : "s"}</p>
          {preview.errors.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto text-xs text-danger">
              {preview.errors.slice(0, 25).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
              {preview.errors.length > 25 && <li>…and {preview.errors.length - 25} more</li>}
            </ul>
          )}
          {preview.rows.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <Table>
                <THead><tr>{factorKeys.map((k) => <Th key={k}>{k}</Th>)}<Th>Rate</Th><Th>Kind</Th><Th>Min</Th></tr></THead>
                <tbody>
                  {preview.rows.slice(0, 8).map((r, i) => (
                    <tr key={i}>{factorKeys.map((k) => <Td key={k}>{String(r.factors[k] ?? "*")}</Td>)}<Td>{r.rate}</Td><Td>{r.rate_kind}</Td><Td>{r.min_premium ?? "—"}</Td></tr>
                  ))}
                </tbody>
              </Table>
              {preview.rows.length > 8 && <p className="mt-1 text-xs text-muted">Showing 8 of {preview.rows.length} rows.</p>}
            </div>
          )}
        </div>
      )}
      <SubmitButton size="sm" disabled={!csv || blocking.length > 0} pendingLabel="Importing…">Import as new rate table</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
