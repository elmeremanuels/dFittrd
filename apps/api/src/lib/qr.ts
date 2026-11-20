import QRCode from 'qrcode';

/** Inline SVG for the desktop QR modal (the SDK renders it through an inert data: URL image). */
export async function qrSvg(text: string): Promise<string> {
  const svg = await QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 256 });
  return svg.trim();
}
