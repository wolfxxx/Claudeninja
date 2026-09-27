import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Hosting support for `*.gltf.json` models (glTF JSON with base64-embedded buffers).
 *
 * Some hosts only serve a short list of file types (no .glb / .bin) and forbid
 * fetching `data:` URIs, which is how GLTFLoader normally reads embedded buffers.
 * For these files we fetch the JSON ourselves, decode the buffers, repack the
 * whole thing as an in-memory GLB and hand that to `parse()`. Textures stay as
 * separate image files next to the JSON.
 */
const originalLoad = GLTFLoader.prototype.load;

GLTFLoader.prototype.load = function (url, onLoad, onProgress, onError) {
  if (!url.endsWith(".gltf.json")) {
    originalLoad.call(this, url, onLoad, onProgress, onError);
    return;
  }
  const resolved = this.path ? this.path + url : url;
  const resourcePath = this.resourcePath || resolved.slice(0, resolved.lastIndexOf("/") + 1);
  fetch(resolved)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} loading ${resolved}`);
      return res.json();
    })
    .then((json) => this.parse(packGlb(json), resourcePath, onLoad, onError))
    .catch((err) => {
      if (onError) onError(err);
      else console.error(err);
    });
};

type GltfJson = {
  buffers?: Array<{ uri?: string; byteLength: number }>;
  bufferViews?: Array<{ buffer: number; byteOffset?: number }>;
};

const align4 = (n: number) => (n + 3) & ~3;

function decodeDataUri(uri: string): Uint8Array {
  const comma = uri.indexOf(",");
  const binary = atob(uri.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Merge every embedded buffer into one GLB BIN chunk and re-point the buffer views. */
function packGlb(json: GltfJson): ArrayBuffer {
  const parts = (json.buffers ?? []).map((buffer) => {
    if (!buffer.uri?.startsWith("data:")) throw new Error("gltf.json buffers must be embedded data URIs");
    return decodeDataUri(buffer.uri);
  });
  const offsets: number[] = [];
  let binLength = 0;
  for (const part of parts) {
    offsets.push(binLength);
    binLength += align4(part.length);
  }
  const bin = new Uint8Array(binLength);
  parts.forEach((part, i) => bin.set(part, offsets[i]));
  for (const view of json.bufferViews ?? []) {
    view.byteOffset = (view.byteOffset ?? 0) + offsets[view.buffer];
    view.buffer = 0;
  }
  json.buffers = binLength > 0 ? [{ byteLength: binLength }] : [];

  const jsonRaw = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = align4(jsonRaw.length);
  const total = 12 + 8 + jsonLength + (binLength > 0 ? 8 + binLength : 0);
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  bytes.set(jsonRaw, 20);
  bytes.fill(0x20, 20 + jsonRaw.length, 20 + jsonLength);
  if (binLength > 0) {
    const at = 20 + jsonLength;
    view.setUint32(at, binLength, true);
    view.setUint32(at + 4, 0x004e4942, true); // "BIN\0"
    bytes.set(bin, at + 8);
  }
  return out;
}
