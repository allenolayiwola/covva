import { ImageResponse } from "next/og";

export const alt = "COVVA — Find cover. Understand it. Move forward.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Default Open Graph card for every page (pages may override with their own). */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #ffffff 0%, #F1F7F3 55%, #DCEEE4 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "#00796E",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 42,
              fontWeight: 700,
            }}
          >
            i
          </div>
          <div style={{ fontSize: 34, fontWeight: 600, color: "#15343E" }}>COVVA</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 22, letterSpacing: 4, fontWeight: 600, color: "#00796E", marginBottom: 20 }}>
            INSURANCE FOR EVERYDAY LIFE IN GHANA
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 84, fontWeight: 700, lineHeight: 1.02, letterSpacing: -3, color: "#15343E" }}>
            <span>Find cover. Understand it.</span>
            <span style={{ color: "#00796E" }}>Move forward.</span>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: 26, color: "#486068" }}>
          <span>Insurance made clearer. Human help built in.</span>
          <span style={{ fontSize: 20, color: "#6F858C" }}>Participating licensed brokers & insurers</span>
        </div>
      </div>
    ),
    size,
  );
}
