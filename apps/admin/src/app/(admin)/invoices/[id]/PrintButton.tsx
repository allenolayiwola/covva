"use client";
import { Printer } from "lucide-react";
import { Button } from "@im/ui";

export function PrintButton() {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden /> Print / save PDF
    </Button>
  );
}
