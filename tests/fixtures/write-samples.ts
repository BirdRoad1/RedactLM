// Writes sample attachments for manual/browser testing: bun tests/fixtures/write-samples.ts <dir>
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
console.log("wrote samples to", dir);
