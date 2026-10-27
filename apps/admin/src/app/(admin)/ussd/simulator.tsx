"use client";

import * as React from "react";
import { Phone, PhoneOff, Send } from "lucide-react";
import { Button, Input, cn } from "@im/ui";
import { simulateHop } from "./actions";

/**
 * Feature-phone style USSD simulator. Each "Send" posts the whole history (`1*2*…`, Africa's
 * Talking semantics) through the simulator adapter, so it exercises exactly the production engine.
 */
export function UssdSimulator({ serviceCode, readOnly }: { serviceCode: string; readOnly: boolean }) {
  const [phone, setPhone] = React.useState("0241234567");
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [inputs, setInputs] = React.useState<string[]>([]);
  const [screen, setScreen] = React.useState<{ type: "CON" | "END"; text: string; chars: number } | null>(null);
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const hop = (sid: string, history: string[]) =>
    start(async () => {
      setError(null);
      const r = await simulateHop({ sessionId: sid, phoneNumber: phone, text: history.join("*") });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setScreen({ type: r.type, text: r.text, chars: r.chars });
      setInputs(history);
      setValue("");
      if (r.type === "END") setSessionId(null);
      else requestAnimationFrame(() => inputRef.current?.focus());
    });

  const dial = () => {
    const sid = crypto.randomUUID();
    setSessionId(sid);
    setScreen(null);
    hop(sid, []);
  };
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId || !value.trim()) return;
    hop(sessionId, [...inputs, value.trim()]);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="mx-auto w-[300px] rounded-[36px] border-[10px] border-ink bg-ink p-3 shadow-float">
        <div className="rounded-[18px] bg-[#cfe3c9] p-3 font-mono text-[13px] leading-snug text-[#1d2b1a]">
          <div className="mb-2 flex justify-between text-[10px] opacity-70"><span>{serviceCode}</span><span>{screen ? `${screen.chars}/160` : ""}</span></div>
          <div aria-live="polite" className="min-h-[180px] whitespace-pre-wrap">
            {pending ? "Connecting…" : screen ? screen.text : sessionId ? "" : `Dial ${serviceCode} to start.`}
          </div>
          {screen?.type === "END" && <p className="mt-2 text-[10px] uppercase tracking-wide opacity-70">Session ended</p>}
        </div>
        <form onSubmit={send} className="mt-3 flex gap-2">
          <label htmlFor="ussd-input" className="sr-only">Reply</label>
          <Input ref={inputRef} id="ussd-input" value={value} onChange={(e) => setValue(e.target.value)} disabled={!sessionId || pending || readOnly} className="h-10 bg-white font-mono" autoComplete="off" maxLength={40} />
          <Button type="submit" size="sm" disabled={!sessionId || pending || !value.trim() || readOnly} aria-label="Send reply"><Send aria-hidden className="size-4" /></Button>
        </form>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" size="sm" onClick={dial} disabled={pending || readOnly} className="bg-[#2e7d32]"><Phone aria-hidden className="size-4" /> Dial</Button>
          <Button type="button" size="sm" variant="danger" onClick={() => { setSessionId(null); setScreen(null); setInputs([]); }} disabled={!sessionId}><PhoneOff aria-hidden className="size-4" /> Hang up</Button>
        </div>
      </div>
      <div className="space-y-3 text-sm">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Caller MSISDN (any Ghana format — a profile with this phone is treated as the customer)
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!!sessionId} className="w-56" />
        </label>
        <p className={cn("text-xs", error ? "text-danger" : "text-muted")} role={error ? "alert" : undefined}>
          {error ?? `History sent: ${inputs.length ? inputs.join("*") : "(empty — first screen)"}`}
        </p>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          <li><code>0</code> goes back, <code>00</code> returns to the main menu.</li>
          <li>END actions are real: SMS links are sent through the configured SMS provider, callbacks create leads and notify support, MoMo prompts go to the instalments / micro modules.</li>
          <li>Every screen is at most 160 characters (counter top right).</li>
        </ul>
      </div>
    </div>
  );
}
