import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Renders each page to a PNG for OCR, and also returns the text stored in the
// page. Both are checked: OCR catches scans and text drawn as images, the
// stored text catches what's in the file but not visible (white-on-white,
// tiny or covered text), which AI services may still read.
export async function* renderPdfPages(data: Uint8Array, { dpi = 300, maxPages = Infinity } = {}) {
  // a plain copy: pdf.js rejects Buffers and takes ownership of what it's given
  const task = getDocument({ data: new Uint8Array(data), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;

  try {
    if (doc.numPages > maxPages) throw new TooManyPagesError(doc.numPages, maxPages);

    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      // white background: transparent areas would otherwise come out black
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      // pdf.js's canvas typing is the DOM one; @napi-rs/canvas is compatible
      await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise;
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
        .join("");
      page.cleanup();
      yield { page: n, pages: doc.numPages, png: canvas.toBuffer("image/png"), text };
    }
  } finally {
    await task.destroy();
  }
}

export class TooManyPagesError extends Error {
  constructor(readonly pages: number, readonly max: number) {
    super(`PDF has ${pages} pages; at most ${max} can be checked`);
  }
}
