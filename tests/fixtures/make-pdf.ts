import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// A "scanned" page: text drawn into an image, so the PDF has no text layer
export function scannedPage(lines: string[], { width = 1700, height = 2200, fontPx = 42 } = {}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111";
  ctx.font = `${fontPx}px sans-serif`;
  lines.forEach((line, i) => ctx.fillText(line, 120, 200 + i * fontPx * 1.6));
  return canvas.toBuffer("image/png");
}

// PDF from page images (like a scanner makes), plus optional text drawn as
// real PDF text, visible or hidden
export async function makePdf(pages: { image?: Buffer; text?: string; hiddenText?: string }[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const p of pages) {
    const page = pdf.addPage([612, 792]); // US Letter
    if (p.image) {
      const img = await pdf.embedPng(p.image);
      page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
    }
    if (p.text) page.drawText(p.text, { x: 72, y: 700, size: 12, font });
    if (p.hiddenText) page.drawText(p.hiddenText, { x: 72, y: 100, size: 12, font, color: rgb(1, 1, 1) });
  }
  return Buffer.from(await pdf.save());
}
