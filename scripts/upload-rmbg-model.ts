/**
 * Download RMBG-1.4 browser weights and upload them to the R2 models bucket.
 *
 * Usage: bun run upload-rmbg-model
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

const BUCKET = "learfield-scraper-models";
const PREFIX = "briaai/RMBG-1.4";
const BASE =
  "https://huggingface.co/briaai/RMBG-1.4/resolve/main";

const FILES: { path: string; contentType: string }[] = [
  { path: "config.json", contentType: "application/json" },
  { path: "preprocessor_config.json", contentType: "application/json" },
  { path: "onnx/quantize_config.json", contentType: "application/json" },
  {
    path: "onnx/model_quantized.onnx",
    contentType: "application/octet-stream",
  },
];

const dir = join(tmpdir(), "rmbg-model-upload");
await mkdir(join(dir, "onnx"), { recursive: true });

for (const file of FILES) {
  const url = `${BASE}/${file.path}`;
  console.log(`Downloading ${file.path}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url} (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const local = join(dir, file.path);
  await writeFile(local, bytes);
  const key = `${BUCKET}/${PREFIX}/${file.path}`;
  console.log(`Uploading ${key} (${bytes.byteLength} bytes)…`);
  await $`./node_modules/.bin/wrangler r2 object put ${key} --file=${local} --content-type=${file.contentType} --remote`;
}

console.log("Done.");
