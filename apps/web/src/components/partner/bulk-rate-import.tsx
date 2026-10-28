"use client";
import { useActionState, useMemo, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button, Checkbox, Field, Input, Notice, Pill, Table, Td, Th, THead } from "@im/ui";
import { bulkRateImportTemplate, parseBulkRateImport, type BulkImportProduct } from "@im/core";
import { FormMessage, SubmitButton, type FormAction } from "./action-form";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * One CSV with a `product_code` column → a draft rate table per product. The preview (per product: rows,
 * errors with file line numbers, unknown codes) is computed in the browser with the same parser the server
 * uses, so what you confirm is what gets imported.
 */
export function BulkRateImportForm({ action, products, defaultFactorKeys }: { action: FormAction; products: BulkImportProduct[]; defaultFactorKeys: string[] }) {
  const [state, formAction] = useActionState(action, { ok: false });
  const [keys, setKeys] = useState(defaultFactorKeys.join(", "));
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [step, setStep] = useState<"upload" | "confirm">("upload");
  const factorKeys = useMemo(() => [...new Set(keys.split(/[,\s]+/).map((k) => k.trim()).filter(Boolean))], [keys]);
  const preview = useMemo(() => (csv ? parseBulkRateImport(csv, factorKeys, products) : null), [csv, factorKeys, products]);
  const groupsWithRows = preview?.groups.filter((g) => g.rows.length) ?? [];
  const issueCount = (preview?.errors.length ?? 0) + (preview?.groups.reduce((n, g) => n + g.errors.length, 0) ?? 0);

  if (state.ok) {
    return (
      <div className="space-y-3">
        <FormMessage state={state} />
        <Button type="button" variant="secondary" size="sm" onClick={() => { setCsv(""); setFileName(null); setStep("upload"); window.location.reload(); }}>Import another file</Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" onSubmit={(e) => { if (step !== "confirm") e.preventDefault(); }}>
      <input type="hidden" name="csv" value={csv} />
      <input type="hidden" name="factorKeys" value={factorKeys.join(",")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name for the new tables" htmlFor="bulk-name" hint="Used for every table created, e.g. “2027 rates”.">
          <Input id="bulk-name" name="name" required minLength={2} maxLength={100} placeholder="2027 rates" className="h-10 text-sm" />
        </Field>
        <Field label="Factor keys (columns, comma-separated)" htmlFor="bulk-keys" hint="The same risk fields for every product in the file, e.g. vehicle_use, region.">
          <Input id="bulk-keys" value={keys} onChange={(e) => { setKeys(e.currentTarget.value); setStep("upload"); }} required className="h-10 text-sm" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => download("bulk-rate-template.csv", bulkRateImportTemplate(factorKeys, products))}>
          <Download className="size-4" /> Download template ({products.length} product{products.length === 1 ? "" : "s"})
        </Button>
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-mist">
          <Upload className="size-4" /> {fileName ?? "Choose CSV file"}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const f = e.currentTarget.files?.[0];
              if (!f) return;
              setFileName(f.name);
              setCsv(await f.text());
              setStep("upload");
            }}
          />
        </label>
      </div>

      {preview && (
        <div className="space-y-3 rounded-card border border-line p-4 text-sm">
          <p className="font-semibold text-ink">
            {preview.totalRows} row{preview.totalRows === 1 ? "" : "s"} · {groupsWithRows.length} product{groupsWithRows.length === 1 ? "" : "s"} · {issueCount} issue{issueCount === 1 ? "" : "s"}
          </p>
          {preview.errors.length > 0 && (
            <ul className="space-y-0.5 text-xs text-danger">
              {preview.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
            </ul>
          )}
          {preview.unknownCodes.length > 0 && (
            <Notice tone="wait">Unknown product codes (rows ignored): {preview.unknownCodes.map((u) => `${u.code} (${u.lines})`).join(", ")}. Your codes: {products.map((p) => p.code).join(", ")}.</Notice>
          )}
          {preview.groups.length > 0 && (
            <Table>
              <THead><tr><Th>Product</Th><Th>Rows</Th><Th>Issues</Th></tr></THead>
              <tbody>
                {preview.groups.map((g) => (
                  <tr key={g.productId}>
                    <Td><span className="font-medium text-ink">{g.name}</span><span className="block text-xs text-muted">{g.code}</span></Td>
                    <Td>{g.rows.length}</Td>
                    <Td className="text-xs">
                      {g.errors.length === 0 ? <Pill tone="ok">OK</Pill> : (
                        <ul className="space-y-0.5 text-danger">
                          {g.errors.slice(0, 5).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
                          {g.errors.length > 5 && <li>…and {g.errors.length - 5} more</li>}
                        </ul>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {groupsWithRows.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted">Show the first rows per product</summary>
              <div className="mt-2 space-y-3">
                {groupsWithRows.map((g) => (
                  <div key={g.productId} className="overflow-x-auto">
                    <p className="mb-1 font-medium text-ink">{g.name}</p>
                    <Table>
                      <THead><tr>{factorKeys.map((k) => <Th key={k}>{k}</Th>)}<Th>Rate</Th><Th>Kind</Th><Th>Min</Th></tr></THead>
                      <tbody>
                        {g.rows.slice(0, 5).map((r, i) => (
                          <tr key={i}>{factorKeys.map((k) => <Td key={k}>{String(r.factors[k] ?? "*")}</Td>)}<Td>{r.rate}</Td><Td>{r.rate_kind}</Td><Td>{r.min_premium ?? "—"}</Td></tr>
                        ))}
                      </tbody>
                    </Table>
                    {g.rows.length > 5 && <p className="mt-1 text-muted">Showing 5 of {g.rows.length} rows.</p>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {step === "upload" ? (
        <Button type="button" size="sm" disabled={!preview?.ok} onClick={() => setStep("confirm")}>
          Review import{groupsWithRows.length ? ` (${groupsWithRows.length} table${groupsWithRows.length === 1 ? "" : "s"})` : ""}
        </Button>
      ) : (
        <div className="space-y-3 rounded-card border border-line bg-mist/50 p-4">
          <p className="text-sm font-semibold text-ink">Confirm: create {groupsWithRows.length} draft rate table{groupsWithRows.length === 1 ? "" : "s"}</p>
          <p className="text-sm text-muted">Each table is attached to the product&apos;s newest draft version (or its current version). Nothing changes live prices: a table is used only after Covva approves it and it is linked to a version&apos;s pricing.</p>
          <ul className="list-disc pl-5 text-sm text-ink-2">
            {groupsWithRows.map((g) => <li key={g.productId}>{g.name}: {g.rows.length} row{g.rows.length === 1 ? "" : "s"}</li>)}
          </ul>
          <Checkbox name="submit" label="Also submit every table for Covva review now" />
          <div className="flex flex-wrap gap-2">
            <SubmitButton size="sm" pendingLabel="Importing…">Import {groupsWithRows.length} table{groupsWithRows.length === 1 ? "" : "s"}</SubmitButton>
            <Button type="button" variant="ghost" size="sm" onClick={() => setStep("upload")}>Back</Button>
          </div>
        </div>
      )}
      <FormMessage state={state} />
    </form>
  );
}
