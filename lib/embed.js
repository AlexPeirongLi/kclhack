// Local sentence embeddings (no API key). The model downloads once and is cached.
import { pipeline } from '@huggingface/transformers';

const MODEL = 'Xenova/all-MiniLM-L6-v2';
let extractor;

/** Embed an array of strings. Returns unit-length vectors (number[][]). */
export async function embed(texts) {
  extractor ??= await pipeline('feature-extraction', MODEL);
  const out = await extractor(texts, { pooling: 'mean', normalize: true });
  return out.tolist();
}

/** Cosine similarity of two unit vectors. */
export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
