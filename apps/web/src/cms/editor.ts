import {
  BlockquoteFeature,
  BlocksFeature,
  BoldFeature,
  FixedToolbarFeature,
  HeadingFeature,
  HorizontalRuleFeature,
  InlineToolbarFeature,
  ItalicFeature,
  LinkFeature,
  OrderedListFeature,
  ParagraphFeature,
  UnorderedListFeature,
  lexicalEditor,
} from "@payloadcms/richtext-lexical";
import type { Block } from "payload";
import { validateCompliantCopy } from "@im/core";

/** "Tip" callout, rendered with the existing Notice component (the typed articles already use it). */
export const TipBlock: Block = {
  slug: "tip",
  labels: { singular: "Tip", plural: "Tips" },
  fields: [{ name: "text", type: "textarea", required: true, validate: validateCompliantCopy }],
};

/**
 * Deliberately small editor: what the site can render safely (see `lexicalToRichNodes` in @im/core).
 * No raw HTML, no embeds, headings h2–h3 only (the page supplies the h1).
 */
export const editor = lexicalEditor({
  features: () => [
    ParagraphFeature(),
    HeadingFeature({ enabledHeadingSizes: ["h2", "h3"] }),
    BoldFeature(),
    ItalicFeature(),
    LinkFeature({ enabledCollections: ["articles", "pages"] }),
    UnorderedListFeature(),
    OrderedListFeature(),
    BlockquoteFeature(),
    HorizontalRuleFeature(),
    BlocksFeature({ blocks: [TipBlock] }),
    FixedToolbarFeature(),
    InlineToolbarFeature(),
  ],
});

/** Shown under every copy field in the admin. */
export const EDITORIAL_NOTE =
  "Covva is a technology platform: never describe it as an insurer or a broker, and never say it holds premiums or client money. Licensed brokers advise, licensed insurers underwrite, and payment goes to the insurer through an authorised provider. Copy that says otherwise is rejected on save.";
