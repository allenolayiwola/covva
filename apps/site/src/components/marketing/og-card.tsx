import { ImageResponse } from "next/og";
import { colors } from "@im/tokens";

/** Social cards only: existing brand colours; no changes to page presentation. */
export function ogCard(title: string, description: string) {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: colors.mist, color: colors.ink, fontFamily: "sans-serif" }}>
      <div style={{ fontSize: 40, color: colors.brand }}>Covva</div>
      <div style={{ fontSize: 60, lineHeight: 1.1 }}>{title}</div>
      <div style={{ fontSize: 25, lineHeight: 1.35, color: colors.muted }}>{description}</div>
      <div style={{ fontSize: 22, color: colors.brand }}>Cover in Ghana · Sold by licensed partners · Technology by Covva</div>
    </div>,
    { width: 1200, height: 630 },
  );
}
