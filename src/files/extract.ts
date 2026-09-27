import { ocrImage } from "./ocr";
import { renderPdfPages, TooManyPagesError } from "./pdf";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 50;

export type Attachment = {
  kind: "pdf" | "image" | "text";
  filename: string;
  bytes: Buffer;
};

// Text found in an attachment: for PDFs, two entries per page (what OCR sees
// and the text stored in the file); a single one otherwise
export type ExtractedPage = { page?: number; text: string; from: "ocr" | "file" };

// Can't be checked, so it can't be sent. Messages are shown to users as-is.
export class UnsupportedAttachmentError extends Error {}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/bmp", "image/gif"];
const TEXT_TYPES = ["application/json", "application/xml", "application/csv"];

// Names people know, for explaining why a file can't be sent
const FRIENDLY_TYPES: Record<string, string> = {
  "application/msword": "a Word document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "a Word document",
  "application/vnd.ms-excel": "an Excel spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "an Excel spreadsheet",
  "application/vnd.ms-powerpoint": "a PowerPoint presentation",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "a PowerPoint presentation",
  "application/zip": "a ZIP archive",
  "application/x-zip-compressed": "a ZIP archive",
  "image/heic": "an iPhone photo (HEIC)",
  "image/svg+xml": "an SVG drawing",
};

function describeType(mime: string, filename: string) {
  if (FRIENDLY_TYPES[mime]) return FRIENDLY_TYPES[mime];
  if (mime.startsWith("audio/")) return "an audio file";
  if (mime.startsWith("video/")) return "a video";
  const ext = /\.([a-z0-9]{1,8})$/i.exec(filename)?.[1];
  return ext ? `a .${ext.toLowerCase()} file` : "this kind of file";
}

const isTextType = (mime: string) => mime.startsWith("text/") || TEXT_TYPES.includes(mime);

// Edits the contents of a plain-text data URI; other kinds come back unchanged
export function rewriteTextDataUri(uri: string, edit: (text: string) => string) {
  const parsed = parseDataUri(uri);
  if (!parsed || !isTextType(parsed.mime)) return uri;
  return `data:${parsed.mime};base64,${Buffer.from(edit(parsed.bytes.toString("utf8"))).toString("base64")}`;
}

function parseDataUri(uri: string) {
  const match = /^data:([^;,]+)?((?:;[^;,]+)*?);base64,(.*)$/s.exec(uri);
  if (!match) return undefined;
  return { mime: (match[1] ?? "application/octet-stream").toLowerCase(), bytes: Buffer.from(match[3]!, "base64") };
}

// Turns an image_url or file content part into something we can read
export function attachmentFromPart(
  part: { type: "image_url"; image_url: { url: string } } | { type: "file"; file: { file_data?: string; file_id?: string; filename?: string } },
  n: number,
): Attachment {
  let data: string | undefined;
  let filename: string;
  if (part.type === "image_url") {
    filename = `Image ${n}`;
    if (!part.image_url.url.startsWith("data:")) {
      throw new UnsupportedAttachmentError(
        "Images must be uploaded rather than linked, so they can be checked before they're sent.",
      );
    }
    data = part.image_url.url;
  } else {
    filename = part.file.filename || `Attachment ${n}`;
    if (!part.file.file_data) {
      throw new UnsupportedAttachmentError(
        `"${filename}" must be uploaded with the message rather than referenced by id, so it can be checked.`,
      );
    }
    data = part.file.file_data;
  }

  const parsed = parseDataUri(data);
  if (!parsed) throw new UnsupportedAttachmentError(`"${filename}" couldn't be read.`);
  if (parsed.bytes.length > MAX_FILE_BYTES) {
    throw new UnsupportedAttachmentError(`"${filename}" is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB, the most that can be checked.`);
  }

  const { mime, bytes } = parsed;
  if (mime === "application/pdf") return { kind: "pdf", filename, bytes };
  if (IMAGE_TYPES.includes(mime)) return { kind: "image", filename, bytes };
  if (isTextType(mime)) return { kind: "text", filename, bytes };
  throw new UnsupportedAttachmentError(
    `"${filename}" can't be checked because it's ${describeType(mime, filename)}. PDFs, images and plain-text files can be sent.`,
  );
}

async function read(attachment: Attachment): Promise<ExtractedPage[]> {
  if (attachment.kind === "text") return [{ text: attachment.bytes.toString("utf8"), from: "file" }];
  if (attachment.kind === "image") return [{ text: await ocrImage(attachment.bytes), from: "ocr" }];

  // PDFs: OCR what each page looks like, and take the text stored in it too.
  // Pages render one at a time while earlier ones are already being read.
  const pages: Promise<ExtractedPage>[] = [];
  for await (const { page, png, text } of renderPdfPages(attachment.bytes, { maxPages: MAX_PDF_PAGES })) {
    pages.push(ocrImage(png).then((ocr) => ({ page, text: ocr, from: "ocr" as const })));
    if (text.trim()) pages.push(Promise.resolve({ page, text, from: "file" as const }));
  }
  return Promise.all(pages);
}

// The same files come back with every turn of a conversation, so results are
// kept (in memory only) by content hash
const cache = new Map<string, Promise<ExtractedPage[]>>();
const CACHE_LIMIT = 50;

export function extractText(attachment: Attachment): Promise<ExtractedPage[]> {
  const key = `${attachment.kind}:${new Bun.CryptoHasher("sha256").update(attachment.bytes).digest("hex")}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const result = read(attachment).catch((err) => {
    cache.delete(key);
    if (err instanceof TooManyPagesError) {
      throw new UnsupportedAttachmentError(
        `"${attachment.filename}" has ${err.pages} pages; at most ${err.max} can be checked.`,
      );
    }
    console.error(`Couldn't read attachment (${attachment.kind}):`, err instanceof Error ? err.message : err);
    throw new UnsupportedAttachmentError(`"${attachment.filename}" couldn't be read. It may be damaged or password-protected.`);
  });

  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
