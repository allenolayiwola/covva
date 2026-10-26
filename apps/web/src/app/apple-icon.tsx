import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Apple touch icon: full-bleed teal tile with a white "C" (iOS applies its own corner mask). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#00796E",
          color: "#ffffff",
          fontSize: 120,
          fontWeight: 700,
          lineHeight: 1,
          fontFamily: "sans-serif",
        }}
      >
        C
      </div>
    ),
    size,
  );
}
