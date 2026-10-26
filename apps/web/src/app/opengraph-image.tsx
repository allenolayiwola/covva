import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Covva — Find cover. Understand it. Move forward.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Default Open Graph card. Uses the supplied horizontal logo file unchanged. */
export default async function OpengraphImage() {
  const png = await readFile(join(process.cwd(), "public", "brand", "horizontal-transparent.png"));
  const logo = `data:image/png;base64,${png.toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 80px",
          background: "linear-gradient(135deg, #ffffff 0%, #F1F7F3 55%, #DCEEE4 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <img src={logo} alt="" width={344} height={140} style={{ marginLeft: -16 }} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 22, letterSpacing: 4, fontWeight: 500, color: "#00796E", marginBottom: 20 }}>INSURANCE FOR EVERYDAY LIFE IN GHANA</div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 82, fontWeight: 400, lineHeight: 1.05, letterSpacing: -2, color: "#15343E" }}>
            <span>Find cover. Understand it.</span>
            <span style={{ color: "#00796E" }}>Move forward.</span>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: 26, color: "#486068" }}>
          <span>Insurance made clearer. Human help built in.</span>
          <span style={{ fontSize: 20, color: "#6F858C" }}>covva.com.gh</span>
        </div>
      </div>
    ),
    size,
  );
}
