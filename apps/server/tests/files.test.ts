import { afterAll, describe, expect, test } from "bun:test";
import { runStaticChecks } from "../src/checkers/run-static-checks";
import { attachmentFromPart, extractText, UnsupportedAttachmentError } from "../src/files/extract";
import { stopOcr } from "../src/files/ocr";
import { makePdf, scannedPage } from "./fixtures/make-pdf";

afterAll(stopOcr);

const dataUri = (mime: string, bytes: Buffer | string) => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
const file = (filename: string, file_data?: string) => ({ type: "file" as const, file: { filename, file_data } });

describe("attachmentFromPart", () => {
  test("recognizes PDFs, images and text files", () => {
    expect(attachmentFromPart(file("a.pdf", dataUri("application/pdf", "%PDF")), 1).kind).toBe("pdf");
    expect(attachmentFromPart({ type: "image_url", image_url: { url: dataUri("image/png", "x") } }, 2)).toMatchObject({ kind: "image", filename: "Image 2" });
    expect(attachmentFromPart(file("notes.csv", dataUri("text/csv", "a,b")), 1).kind).toBe("text");
  });

  test.each([
    ["linked image", { type: "image_url" as const, image_url: { url: "https://example.com/a.png" } }, "uploaded rather than linked"],
    ["file id", { type: "file" as const, file: { filename: "a.pdf", file_id: "file-123" } }, "referenced by id"],
    ["Word document", file("a.docx", dataUri("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x")), "because it's a Word document"],
    ["unknown type", file("a.xyz", dataUri("application/x-thing", "x")), "because it's a .xyz file"],
    ["too large", file("big.pdf", dataUri("application/pdf", Buffer.alloc(21 * 1024 * 1024))), "larger than 20 MB"],
  ])("refuses a %s, saying why", (_, part, message) => {
    expect(() => attachmentFromPart(part, 1)).toThrow(UnsupportedAttachmentError);
    expect(() => attachmentFromPart(part, 1)).toThrow(message);
  });
});

describe("extractText (OCR, local)", () => {
  test("reads a scanned PDF well enough to catch what's on it", async () => {
    const pdf = await makePdf([
      { image: scannedPage(["CLIENT INTAKE FORM", "SSN: 123-45-6789", "Phone: (212) 555-1234", "Email: m.oconnell@example.com"]) },
    ]);
    const pages = await extractText(attachmentFromPart(file("intake.pdf", dataUri("application/pdf", pdf)), 1));
    expect(pages).toHaveLength(1);
    expect(pages[0]!.page).toBe(1);
    const found = runStaticChecks(pages[0]!.text).map((d) => `${d.checker}:${d.contents}`);
    expect(found).toContain("ssn:123-45-6789");
    expect(found).toContain("phone:(212) 555-1234");
    expect(found).toContain("email:m.oconnell@example.com");
  }, 60_000);

  test("reads both what pages show and the text stored in the file", async () => {
    const pdf = await makePdf([
      { image: scannedPage(["Scanned SSN 123-45-6789"]), hiddenText: "HIDDEN 987-65-4321" },
    ]);
    const pages = await extractText(attachmentFromPart(file("p.pdf", dataUri("application/pdf", pdf)), 1));
    const ocr = pages.find((p) => p.from === "ocr")!;
    const stored = pages.find((p) => p.from === "file")!;
    // the scan has no stored text, and white-on-white text isn't visible
    expect(ocr.text).toContain("123-45-6789");
    expect(ocr.text).not.toContain("987-65-4321");
    // ...but it's in the file, where an AI service could read it
    expect(stored.text).toContain("987-65-4321");
    expect(stored.page).toBe(1);
  }, 60_000);

  test("reads images and plain text", async () => {
    const [img] = await extractText(attachmentFromPart({ type: "image_url", image_url: { url: dataUri("image/png", scannedPage(["Card 4111 1111 1111 1111"])) } }, 1));
    expect(runStaticChecks(img!.text).map((d) => d.checker)).toContain("credit-card");
    const [txt] = await extractText(attachmentFromPart(file("a.txt", dataUri("text/plain", "call 212-555-1234")), 1));
    expect(txt!.text).toBe("call 212-555-1234");
  }, 60_000);

  test("damaged files are refused with a readable reason", async () => {
    const broken = attachmentFromPart(file("broken.pdf", dataUri("application/pdf", "%PDF-1.7 not really")), 1);
    await expect(extractText(broken)).rejects.toThrow('"broken.pdf" couldn\'t be read');
  }, 60_000);
});
