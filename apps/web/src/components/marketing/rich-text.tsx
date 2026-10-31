import * as React from "react";
import Link from "next/link";
import { Lightbulb } from "lucide-react";
import { Notice, cn } from "@im/ui";
import type { InlineNode, RichNode } from "@im/core";

/**
 * Renders the safe rich-text tree produced by `lexicalToRichNodes` (@im/core). Only known node
 * types reach the DOM; there is no HTML injection anywhere. Styles match the Learn articles
 * (17px body, 13px minimum, brand marker colours).
 */
const P = "mt-4 text-[17px] leading-relaxed text-ink-2";

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case "break":
            return <br key={i} />;
          case "link": {
            const external = /^https?:\/\//i.test(n.href);
            const cls = "font-medium text-brand underline underline-offset-4 decoration-brand/40 hover:decoration-brand rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";
            return external || n.newTab ? (
              <a key={i} href={n.href} className={cls} target={n.newTab ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>
                <Inline nodes={n.children} />
              </a>
            ) : (
              <Link key={i} href={n.href} className={cls}>
                <Inline nodes={n.children} />
              </Link>
            );
          }
          default: {
            let el: React.ReactNode = n.text;
            if (n.code) el = <code className="rounded bg-mist px-1 py-0.5 text-[0.92em]">{el}</code>;
            if (n.italic) el = <em>{el}</em>;
            if (n.bold) el = <strong className="font-semibold text-ink">{el}</strong>;
            return <React.Fragment key={i}>{el}</React.Fragment>;
          }
        }
      })}
    </>
  );
}

export function RichText({ nodes, className }: { nodes: RichNode[]; className?: string }) {
  return (
    <div className={cn("[&>*:first-child]:mt-0", className)}>
      {nodes.map((n, i) => {
        switch (n.type) {
          case "heading":
            return n.level === 2 ? (
              <h2 key={i} className="mt-10 text-[30px] leading-[1.12] md:text-[42px] text-ink"><Inline nodes={n.children} /></h2>
            ) : n.level === 3 ? (
              <h3 key={i} className="mt-8 text-[20px] leading-[1.25] md:text-[24px] text-ink"><Inline nodes={n.children} /></h3>
            ) : (
              <h4 key={i} className="mt-6 text-[20px] leading-[1.25] text-ink"><Inline nodes={n.children} /></h4>
            );
          case "list":
            return n.ordered ? (
              <ol key={i} className="mt-4 list-decimal space-y-2 pl-6 text-[17px] leading-relaxed text-ink-2 marker:font-semibold marker:text-brand">
                {n.items.map((it, j) => <li key={j}><Inline nodes={it} /></li>)}
              </ol>
            ) : (
              <ul key={i} className="mt-4 list-disc space-y-2 pl-6 text-[17px] leading-relaxed text-ink-2 marker:text-brand">
                {n.items.map((it, j) => <li key={j}><Inline nodes={it} /></li>)}
              </ul>
            );
          case "quote":
            return (
              <blockquote key={i} className="mt-6 border-l-4 border-brand/40 pl-5 text-[17px] italic leading-relaxed text-ink-2"><Inline nodes={n.children} /></blockquote>
            );
          case "tip":
            return (
              <Notice key={i} tone="ok" icon={<Lightbulb className="size-4" />} title="Tip" className="mt-6">
                {n.text}
              </Notice>
            );
          case "rule":
            return <hr key={i} className="my-10 border-line" />;
          default:
            return <p key={i} className={P}><Inline nodes={n.children} /></p>;
        }
      })}
    </div>
  );
}
