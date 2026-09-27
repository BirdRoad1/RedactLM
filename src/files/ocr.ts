import path from "node:path";
import { createScheduler, createWorker, OEM, type Scheduler } from "tesseract.js";

// English LSTM model ("best_int": the accurate one, integer-quantized for
// speed), loaded from node_modules so nothing is fetched at runtime
const LANG_PATH = path.join(
  path.dirname(require.resolve("@tesseract.js-data/eng/package.json")),
  "4.0.0_best_int",
);

// OCR is CPU-heavy: a small fixed pool, with pages queued behind it
const WORKERS = Math.max(1, Math.min(4, Number(process.env.OCR_WORKERS) || 2));

let scheduler: Promise<Scheduler> | undefined;

function getScheduler() {
  scheduler ??= (async () => {
    const s = createScheduler();
    for (let i = 0; i < WORKERS; i++) {
      s.addWorker(await createWorker("eng", OEM.LSTM_ONLY, { langPath: LANG_PATH, gzip: true, cacheMethod: "none" }));
    }
    return s;
  })();
  return scheduler;
}

// Text in an image (PNG, JPEG, WebP, BMP, GIF). Runs locally.
export async function ocrImage(image: Buffer) {
  const s = await getScheduler();
  const { data } = await s.addJob("recognize", image);
  return data.text;
}

export async function stopOcr() {
  if (scheduler) await (await scheduler).terminate();
  scheduler = undefined;
}
