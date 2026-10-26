"use client";
import * as React from "react";
import { Gift } from "lucide-react";
import { Button, Card, Notice } from "@im/ui";
import { openGift } from "./actions";

export function RevealGift({ sponsorshipId, revealed, message, from }: { sponsorshipId: string; revealed: boolean; message: string | null; from: string }) {
  const [state, setState] = React.useState<{ revealed: boolean; message: string | null; error?: string }>({ revealed, message });
  const [pending, start] = React.useTransition();
  if (state.revealed) {
    return (
      <Card className="mt-6 p-6 text-center">
        <Gift aria-hidden className="mx-auto size-8 text-brand" />
        <p className="mt-3 text-sm font-medium uppercase tracking-[0.1em] text-muted">A message from {from}</p>
        <p className="mt-2 whitespace-pre-line text-lg text-ink">{state.message ? `“${state.message}”` : `${from} arranged this cover for you.`}</p>
      </Card>
    );
  }
  return (
    <Card className="mt-6 p-6 text-center">
      <Gift aria-hidden className="mx-auto size-8 text-brand" />
      <p className="mt-3 text-ink">There is a message waiting for you.</p>
      <Button
        className="mt-4"
        size="lg"
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await openGift(sponsorshipId);
            if (r.ok) setState({ revealed: true, message: r.message ?? null });
            else setState((s) => ({ ...s, error: r.error }));
          })
        }
      >
        Open your gift
      </Button>
      {state.error && <Notice tone="danger" className="mt-4">{state.error}</Notice>}
    </Card>
  );
}
