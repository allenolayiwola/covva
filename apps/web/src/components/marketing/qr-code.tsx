import { encodeQr, qrPath } from "./qr";

/**
 * Inline SVG QR code (dependency-free, rendered on the server). `label` is the accessible name;
 * include the destination so screen-reader users know where it points.
 */
export function QrCode({ value, size = 128, label, className }: { value: string; size?: number; label: string; className?: string }) {
  const matrix = encodeQr(value);
  const quiet = 2;
  const box = matrix.size + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${box} ${box}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={box} height={box} fill="#fff" />
      <path transform={`translate(${quiet} ${quiet})`} d={qrPath(matrix)} fill="#15343E" />
    </svg>
  );
}
