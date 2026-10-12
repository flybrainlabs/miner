// Optional full-data acceptance check. Inputs are generated under ignored data/prepared.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';

const [wasmPath, graphPath, modelPath, nativePath] = process.argv.slice(2);
if (!nativePath) {
  console.error('usage: node tests/sim_wasm_full.mjs SIM.wasm GRAPH.bin MODEL.bin NATIVE_RESPONSE.bin');
  process.exit(2);
}
const samples=[];
const { instance } = await WebAssembly.instantiate(await readFile(wasmPath), {flypow:{progress:(...counts)=>samples.push(counts)}});
const { memory, flypow_alloc: alloc, flypow_free: free, flypow_sha256: wasmSha, flypow_run: run } = instance.exports;
async function loadFile(path) {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    assert.ok(size > 0 && size < 0x1_0000_0000);
    const pointer = alloc(size);
    assert.ok(pointer > 0);
    const chunk = Buffer.allocUnsafe(8 * 1024 * 1024);
    let offset = 0;
    while (offset < size) {
      const count = Math.min(chunk.length, size - offset);
      const { bytesRead } = await file.read(chunk, 0, count, offset);
      assert.ok(bytesRead > 0);
      new Uint8Array(memory.buffer, pointer + offset, bytesRead).set(chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
    return { pointer, length: size };
  } finally { await file.close(); }
}
const graph = await loadFile(graphPath);
const model = await loadFile(modelPath);
const hashPointer = alloc(32);
assert.equal(wasmSha(graph.pointer, graph.length, hashPointer), 1);
const graphHash = Buffer.from(new Uint8Array(memory.buffer, hashPointer, 32)).toString('hex');
assert.equal(graphHash, '6c42f6ff8e2198aca17a765acae0475b490abb0169d615e32b71c976f563deb4');
const lengthPointer = alloc(4);
const started = performance.now();
const resultPointer = run(graph.pointer, graph.length, model.pointer, model.length,
  16789n, 32, 4, 12, 200n, 0x4c4f43414c5f7630n, lengthPointer);
assert.ok(resultPointer > 0, 'WASM simulation rejected the full graph or model');
const resultLength = new DataView(memory.buffer).getUint32(lengthPointer, true);
const result = Buffer.from(new Uint8Array(memory.buffer, resultPointer, resultLength));
const native = await readFile(nativePath);
assert.deepEqual(result, native, 'native and WASM response bytes must match exactly');
assert.equal(samples.length,33,'initial state and every genuinely completed step');
for(const [index,s]of samples.entries()){
  assert.equal(s[0],index);assert.equal(s[1],32);assert.equal(s[2],2n*165122n*BigInt(index));
  if(index)assert(s[3]>=samples[index-1][3]);
}
// Independent cross-check from saved actual spike events and CSR degrees.
// Each spike adds once per outgoing connection; A and B count independently.
const view=new DataView(memory.buffer),offsets=graph.pointer+52+165122*8;
let additions=0n;
for(let at=480;at<result.length;at+=8){const cell=result.readUInt32LE(at+4);additions+=view.getBigUint64(offsets+(cell+1)*8,true)-view.getBigUint64(offsets+cell*8,true);}
assert.equal(samples.at(-1)[3],additions,'actual synaptic additions, independently derived from response spikes');
assert.equal(samples.at(-1)[4],result.readBigUInt64LE(24));assert.equal(samples.at(-1)[5],result.readBigUInt64LE(32));
console.log(JSON.stringify({ neuronCount: 165122, directedConnections: 25563197,
  responseBytes: resultLength, resultSha256: createHash('sha256').update(result).digest('hex'),
  wasmElapsedMs: Math.round(performance.now() - started), exactNativeMatch: true,progressSamples:samples.length,neuronUpdates:String(samples.at(-1)[2]),synapseTransmissions:String(additions) }));
free(resultPointer, resultLength);
free(lengthPointer, 4);
free(hashPointer, 32);
free(model.pointer, model.length);
free(graph.pointer, graph.length);
