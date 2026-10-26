import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** Favicon: teal rounded tile with a white "i" (brand mark). */
export default function Icon() {
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
          borderRadius: 16,
          color: "#ffffff",
          fontSize: 44,
          fontWeight: 700,
          lineHeight: 1,
          fontFamily: "sans-serif",
        }}
      >
        i
      </div>
    ),
    size,
  );
}
