/**
 * The QR encoder now lives in `@im/core` (`packages/core/src/qr.ts`) so policy documents can
 * embed the same code. This module stays as a thin re-export for the marketing site.
 */
export { encodeQr, qrMatrix, qrPath, qrSvg, type QrMatrix, type QrSvgOptions } from "@im/core";
