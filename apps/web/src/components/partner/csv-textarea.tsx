"use client";
import { useState } from "react";
import { Field, Textarea } from "@im/ui";
import { TemplateDownload } from "./rate-table-editor";

/** Optional CSV rows for a broker proposal: paste, or pick a file that is read into the textarea. */
export function CsvTextarea() {
  const [csv, setCsv] = useState("");
  return (
    <Field label="Rates (CSV, optional)" htmlFor="pr-csv" hint="Columns: the factor keys above, then rate, rate_kind (rate_on_value | flat | per_unit), min_premium. Use * for any value.">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <TemplateDownload factorKeys={["vehicle_use", "vehicle_age_band", "region"]} name="rate-proposal-template.csv" />
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" className="text-sm" onChange={async (e) => { const f = e.currentTarget.files?.[0]; if (f) setCsv(await f.text()); }} />
      </div>
      <Textarea id="pr-csv" name="csv" rows={6} value={csv} onChange={(e) => setCsv(e.currentTarget.value)} className="font-mono text-xs" placeholder={"vehicle_use,vehicle_age_band,region,rate,rate_kind,min_premium\nprivate,*,*,0.045,rate_on_value,400"} />
    </Field>
  );
}
