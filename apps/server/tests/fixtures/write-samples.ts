// Writes sample attachments for manual/browser testing: bun tests/fixtures/write-samples.ts <dir>
import { PDFDocument, StandardFonts } from "pdf-lib";
import { makePdf, scannedPage } from "./make-pdf";

const dir = process.argv[2] ?? ".";
await Bun.write(`${dir}/intake.pdf`, await makePdf([
  { image: scannedPage(["CLIENT INTAKE FORM", "Name: Margaret O'Connell", "SSN: 123-45-6789", "Notes: prefers email contact"]) },
]));
await Bun.write(`${dir}/meeting-notes.pdf`, await makePdf([
  { image: scannedPage(["Q3 planning notes", "Agenda: budget review, hiring plan"]) },
  { image: scannedPage(["Follow-ups", "Vendor callback at 212-555-1234 on Friday"]) },
]));
await Bun.write(`${dir}/report.docx`, "not really a docx");

// ~14,000 characters of ordinary text: longer than the AI check reads by default
const longPdf = await PDFDocument.create();
const font = await longPdf.embedFont(StandardFonts.Helvetica);
const sentence = "Regional revenue grew steadily while operating costs held flat through the quarter. ";
for (let p = 0; p < 3; p++) {
  const page = longPdf.addPage([612, 792]);
  for (let line = 0; line < 55; line++) page.drawText(sentence, { x: 30, y: 760 - line * 13, size: 8, font });
}
await Bun.write(`${dir}/long-report.pdf`, await longPdf.save());
console.log("wrote samples to", dir);
