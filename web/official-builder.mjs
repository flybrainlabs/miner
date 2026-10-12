// Apache Arrow reads one compressed Feather record batch at a time from a File.
// No raw official object is ever read into one ArrayBuffer.
import { RecordBatchReader, compressionRegistry, CompressionType } from 'apache-arrow';
import { decompress as lz4 } from 'lz4js';
import { decompress as zstd } from 'fzstd';
import { sha256 } from '@noble/hashes/sha256';
compressionRegistry.set(CompressionType.LZ4_FRAME, { decode: lz4 });
compressionRegistry.set(CompressionType.ZSTD, { decode: zstd });
export const hex = a => Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
export const hashBytes = bytes => hex(sha256(bytes));
export const createHasher = () => sha256.create();
const trustedFiles=new WeakMap();
export async function hashFile(file, progress = () => {}) {
  const h = sha256.create(); let n = 0;
  for (let offset = 0; offset < file.size; offset += 4 * 1024 * 1024) {
    const b = new Uint8Array(await file.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer());
    h.update(b); n += b.length; progress(n, file.size);
  }
  return hex(h.digest());
}
function fileHandle(file) {
  // Arrow's public FileHandle adapter uses fd only as a type marker; reads are supplied below.
  return { fd: -1, stat: async () => ({ size: file.size }), close: async () => {},
    read: async (buffer, offset, length, position) => {
      if (length > 64 * 1024 * 1024) throw new Error('Official Arrow batch exceeds the bounded reader');
      const b = new Uint8Array(await file.slice(position, position + length).arrayBuffer());
      buffer.set(b, offset); return { bytesRead: b.length, buffer };
    } };
}
export async function* batches(file) {
  const reader = await RecordBatchReader.from(fileHandle(file));
  try { await reader.open(); for await (const batch of reader) yield batch; }
  finally { await reader.cancel(); }
}
const safe = v => { const n = Number(v); if (!Number.isSafeInteger(n) || n < 0) throw new Error('Official ID outside exact numeric range'); return n; };
function writeMagic(view, magic) { new Uint8Array(view.buffer, view.byteOffset, 8).set(new TextEncoder().encode(magic)); }

export async function verifyOfficialInputs(files, manifest, progress = () => {}, onVerified = async () => {}) {
  if (manifest.schema !== 'flypow-official-inputs-v1' || manifest.builder !== 'traced-csr-lif-dev-v1') throw new Error('Unknown official builder');
  for (const source of manifest.sources) {
    const file = files[source.id];
    const detail={sourceId:source.id,sourceStage:'checking',unit:'bytes'};
    const proof=trustedFiles.get(file);
    if(proof===source.sha256){await onVerified(source,file);progress('Checked '+source.id,source.bytes,source.bytes,{...detail,sourceStage:'checked',status:'skipped'});continue;}
    progress('Checking ' + source.id,0,source.bytes,detail);
    if (!file || file.size !== source.bytes || await hashFile(file, (loaded,total) => progress('Checking ' + source.id,loaded,total,detail)) !== source.sha256) {
      const error=new Error('Official source length/SHA-256 mismatch: ' + source.id);
      error.sourceId=source.id;throw error;
    }
    await onVerified(source,file);
    trustedFiles.set(file,source.sha256);
    progress('Checked ' + source.id,source.bytes,source.bytes,{...detail,sourceStage:'checked'});
  }
}

export async function buildOfficial(files, manifest, config, write, progress = () => {}, onVerified = async () => {}) {
  const started = performance.now();
  await verifyOfficialInputs(files,manifest,progress,onVerified);
  progress('All inputs checked',manifest.sources.length,manifest.sources.length,{stageId:'verify',unit:'files',status:'completed'});
  const rows = []; let sourceRows = 0;
  for await (const batch of batches(files.annotation)) {
    const get = name => batch.getChild(name);
    const body = get('bodyId'), status = get('status'), type = get('type'), side = get('somaSide'), group = get('superclass');
    for (let i = 0; i < batch.numRows; i++) { sourceRows++; if (status.get(i) === 'Traced') rows.push({ body: safe(body.get(i)), type: type.get(i), side: side.get(i), group: group.get(i) }); }
    progress('Building identities',sourceRows,211577);
  }
  rows.sort((a,b) => a.body-b.body);
  if (rows.length !== config.neuron_count || rows.some((r,i) => !r.body || (i && rows[i-1].body===r.body))) throw new Error('Official registry count/uniqueness mismatch');
  const ids = new Map(rows.map((r,i) => [r.body,i])); const enc = new TextEncoder();
  const names = rows.map(r => enc.encode(r.type || ''));
  const registry = new Uint8Array(16 + names.reduce((n,b) => n+11+b.length,0)); const rv = new DataView(registry.buffer);
  writeMagic(rv,'FBRG1\0\0\0'); rv.setBigUint64(8,BigInt(rows.length),true); let cursor=16;
  for (let i=0;i<rows.length;i++) {
    const r=rows[i], name=names[i], side={L:1,R:2,M:3}[r.side] || 0;
    if (name.length>65535 || (r.side!=null && !['L','R','M'].includes(r.side))) throw new Error('Unknown official side/type encoding');
    rv.setBigUint64(cursor,BigInt(r.body),true); rv.setUint8(cursor+8,side); rv.setUint16(cursor+9,name.length,true); registry.set(name,cursor+11); cursor+=11+name.length;
  }
  if (hashBytes(registry)!==manifest.registry_sha256) throw new Error('Constructed registry differs from frozen version');
  const pilot=rows.filter(r=>r.type==='aIPg10');
  if (pilot.length!==4 || pilot.map(r=>r.body).join(',')!==config.target_body_ids.join(',')) throw new Error('aIPg10 official identities differ');
  await write('neuron-registry-v1.bin',registry);
  const counts = new Uint32Array(rows.length); const coverage = { source_rows:0,both_mapped_rows:0,only_pre_mapped_rows:0,only_post_mapped_rows:0,neither_mapped_rows:0,included_weight_sum:0 };
  const scan = async (consume, pass) => {
    let loaded=0;
    for await (const batch of batches(files.weights)) {
      const pre=batch.getChild('body_pre').toArray(), post=batch.getChild('body_post').toArray(), weights=batch.getChild('weight').toArray();
      for (let i=0;i<batch.numRows;i++) consume(safe(pre[i]),safe(post[i]),safe(weights[i]));
      loaded+=batch.numRows; progress(pass,loaded,151856684);
    }
  };
  await scan((a,b,w) => {
    const pre=ids.get(a), post=ids.get(b); coverage.source_rows++;
    if (pre!==undefined && post!==undefined) { if (!w || w>0xffffffff || counts[pre]===0xffffffff) throw new Error('Connection weight/count overflow'); counts[pre]++; coverage.both_mapped_rows++; coverage.included_weight_sum+=w; }
    else coverage[pre!==undefined?'only_pre_mapped_rows':post!==undefined?'only_post_mapped_rows':'neither_mapped_rows']++;
  },'Counting full registered connections');
  coverage.unmapped_unique_body_ids=null;
  coverage.unmapped_unique_limitation='Endpoint row counts are exact; counting distinct excluded fragments requires an external sort and is not inferred from row counts.';
  if (coverage.both_mapped_rows!==config.directed_connection_count) throw new Error('Connection coverage differs from frozen full graph');
  const offsets=new Uint32Array(rows.length+1);
  for (let i=0;i<rows.length;i++) offsets[i+1]=offsets[i]+counts[i];
  let graph = new Uint8Array(config.graph_bytes); const gv = new DataView(graph.buffer);
  writeMagic(gv,'FBGR1\0\0\0'); gv.setUint32(8,rows.length,true); gv.setBigUint64(12,BigInt(offsets.at(-1)),true);
  graph.set(Uint8Array.from(manifest.registry_sha256.match(/../g),h=>parseInt(h,16)),20);
  for (let i=0;i<rows.length;i++) gv.setBigUint64(52+i*8,BigInt(rows[i].body),true);
  const os=52+rows.length*8; for (let i=0;i<offsets.length;i++) gv.setBigUint64(os+i*8,BigInt(offsets[i]),true);
  const es=os+offsets.length*8; const edges=new Uint32Array(graph.buffer,es); const position=offsets.slice(0,-1);
  await scan((a,b,w)=>{ const pre=ids.get(a), post=ids.get(b); if(pre!==undefined && post!==undefined) { const k=position[pre]++; if(k>=offsets[pre+1]) throw new Error('Connection mapping changed during build'); edges[2*k]=post; edges[2*k+1]=w; } },'Building full registered connections');
  for (let i=0;i<rows.length;i++) {
    if(position[i]!==offsets[i+1]) throw new Error('Incomplete connection source');
    const start=offsets[i], n=counts[i];
    if(n>1) { const order=Array.from({length:n},(_,j)=>start+j).sort((a,b)=>edges[2*a]-edges[2*b]); const temp=new Uint32Array(2*n); for(let j=0;j<n;j++) { temp[2*j]=edges[2*order[j]]; temp[2*j+1]=edges[2*order[j]+1]; if(j && temp[2*j]<=temp[2*j-2]) throw new Error('Duplicate anatomical pair requires a new aggregation policy'); } edges.set(temp,start*2); }
    if(i%4096===0) { progress('Sorting full graph',i,rows.length); await new Promise(resolve=>setTimeout(resolve,0)); }
  }
  if(hashBytes(graph)!==config.graph_sha256) throw new Error('Browser-built graph SHA-256 differs from frozen version');
  await write('graph-v1.bin',graph);
  const sign = { acetylcholine:1,gaba:-1,histamine:-1,glutamate:1,dopamine:1,octopamine:1,serotonin:1,unclear:1 };
  const labels=new Map();
  for await(const batch of batches(files.transmitter)) {
    const body=batch.getChild('body'), nt=batch.getChild('consensus_nt');
    for(let i=0;i<batch.numRows;i++) { const id=safe(body.get(i)); if(ids.has(id)) { if(labels.has(id)) throw new Error('Duplicate transmitter identity'); const label=nt.get(i); if(label!=null && !(label in sign)) throw new Error('Unknown neurotransmitter mapping'); labels.set(id,label); } }
  }
  const model=new Uint8Array(44+4*rows.length); const mv=new DataView(model.buffer);
  writeMagic(mv,'FBMD1\0\0\0'); mv.setUint32(8,rows.length,true); model.set(Uint8Array.from(config.graph_sha256.match(/../g),h=>parseInt(h,16)),12);
  for(let i=0;i<rows.length;i++) { const vnc=(rows[i].group||'').startsWith('vnc_')?1:0; model[44+i]=(sign[labels.get(rows[i].body)]||1)&255; model[44+rows.length+i]=vnc; mv.setUint16(44+2*rows.length+2*i,vnc,true); }
  if(hashBytes(model)!==config.model_sha256) throw new Error('Browser-built model SHA-256 differs from frozen version');
  await write('model-v0.bin',model);
  return {schema:'flypow-browser-build-report-v1',builder:manifest.builder,neuron_count:rows.length,source_rows:sourceRows,excluded_neurons:sourceRows-rows.length,missing_type:rows.filter(r=>r.type==null).length,missing_side:rows.filter(r=>r.side==null).length,coverage,elapsed_ms:Math.round(performance.now()-started),state:'UNCALIBRATED_DEV_ONLY'};
}
