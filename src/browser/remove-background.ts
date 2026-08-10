import {
  env,
  AutoModel,
  AutoProcessor,
  RawImage,
  type PreTrainedModel,
  type Processor,
} from "@huggingface/transformers";

const MODEL_ID = "briaai/RMBG-1.4";

/** Processor overrides from the working RMBG-1.4 browser demos. */
const PROCESSOR_CONFIG = {
  do_normalize: true,
  do_pad: false,
  do_rescale: true,
  do_resize: true,
  image_mean: [0.5, 0.5, 0.5],
  feature_extractor_type: "ImageFeatureExtractor",
  image_std: [1, 1, 1],
  resample: 2,
  rescale_factor: 0.00392156862745098,
  size: { width: 1024, height: 1024 },
};

type Remover = {
  model: PreTrainedModel;
  processor: Processor;
};

let loadPromise: Promise<Remover> | null = null;

/**
 * Lazily load RMBG-1.4 via AutoModel (not the image-segmentation pipeline —
 * that rejects RMBG's SegformerForSemanticSegmentation model_type).
 * Prefers WebGPU; falls back to WASM/CPU.
 *
 * Model weights are served from this origin (`/models/...` → R2) to avoid
 * Hugging Face CORS blocks in the browser.
 */
export function loadBackgroundRemover(): Promise<Remover> {
  if (!loadPromise) {
    loadPromise = (async () => {
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.remoteHost = `${globalThis.location?.origin ?? ""}/models/`;
      env.remotePathTemplate = "{model}/";

      const wasm = env.backends.onnx.wasm as { proxy?: boolean } | undefined;
      if (wasm) wasm.proxy = false;

      const preferWebGpu =
        typeof navigator !== "undefined" && "gpu" in navigator;

      const load = async (device?: "webgpu") => {
        const model = await AutoModel.from_pretrained(MODEL_ID, {
          // RMBG ships a custom ONNX graph; force generic AutoModel loading
          // (same approach as porameht/bg-remove-webgpu).
          config: { model_type: "custom" } as never,
          ...(device ? { device } : {}),
        });
        const processor = await AutoProcessor.from_pretrained(MODEL_ID, {
          config: PROCESSOR_CONFIG as never,
        });
        return { model, processor };
      };

      if (preferWebGpu) {
        try {
          return await load("webgpu");
        } catch (err) {
          console.warn(
            "WebGPU RMBG-1.4 unavailable, falling back to WASM:",
            err,
          );
        }
      }

      return await load();
    })().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

/**
 * Remove the background from an image, returning PNG bytes with alpha.
 */
export async function removeImageBackground(
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const { model, processor } = await loadBackgroundRemover();
  const input = new Blob([Uint8Array.from(bytes)], {
    type: "application/octet-stream",
  });
  const img = await RawImage.fromBlob(input);

  const { pixel_values } = await processor(img);
  // RMBG expects the tensor under `input`, not `pixel_values`.
  const result = await model({ input: pixel_values });
  const output = result.output ?? result.logits ?? Object.values(result)[0];
  if (!output) {
    throw new Error("RMBG-1.4 returned no mask tensor");
  }

  const mask = await RawImage.fromTensor(output[0].mul(255).to("uint8")).resize(
    img.width,
    img.height,
  );
  const cutout = img.putAlpha(mask);
  const outBlob = await cutout.toBlob("image/png");
  return new Uint8Array(await outBlob.arrayBuffer());
}
