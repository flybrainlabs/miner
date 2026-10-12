import assert from 'node:assert/strict';
import { tableFromArrays,tableToIPC } from 'apache-arrow';
import { batches,hashFile,hashBytes,verifyOfficialInputs,buildOfficial } from '../web/official-builder.mjs';
const file=new Blob([tableToIPC(tableFromArrays({bodyId:new BigInt64Array([16789n,16961n]),status:['Traced','Traced']}),'file')]);let count=0;for await(const batch of batches(file))count+=batch.numRows;assert.equal(count,2);
const manifest={schema:'flypow-official-inputs-v1',builder:'traced-csr-lif-dev-v1',sources:[{id:'annotation',bytes:file.size,sha256:'00'.repeat(32)}]};await assert.rejects(()=>buildOfficial({annotation:file},manifest,{},()=>{}),/SHA-256 mismatch/);
assert.equal((await hashFile(file)).length,64);console.log('Random-access Arrow batch adapter and frozen source rejection passed');

// Count actual file reads, including a source spanning several bounded blocks.
// A complete source check must read each input once and reject bad bytes before
// they can be marked checked or used to construct any model artifact.
class ObservedBlob extends Blob {
  bytesRead=0;
  slice(start,end){const b=super.slice(start,end);this.bytesRead+=b.size;return b;}
}
const inputs={},sources=[];
for(const [id,length]of [['annotation',61],['weights',4*1024*1024+17],['transmitter',93]]){
  const bytes=new Uint8Array(length).fill(length%251);
  inputs[id]=new ObservedBlob([bytes]);sources.push({id,bytes:length,sha256:hashBytes(bytes)});
}
const checked=[],progress=[],sourceManifest={...manifest,sources};
await verifyOfficialInputs(inputs,sourceManifest,(label,loaded,total,detail)=>progress.push({label,loaded,total,...detail}),s=>checked.push(s.id));
assert.deepEqual(checked,sources.map(s=>s.id));
for(const s of sources){
  assert.equal(inputs[s.id].bytesRead,s.bytes);
  assert.equal(progress.filter(p=>p.label==='Checking '+s.id&&p.loaded===0).length,1);
  assert.equal(progress.filter(p=>p.label==='Checking '+s.id&&p.loaded===s.bytes).length,1);
  assert.equal(progress.filter(p=>p.label==='Checked '+s.id).length,1);
  assert(progress.filter(p=>p.label==='Checking '+s.id).every(p=>p.sourceId===s.id&&p.sourceStage==='checking'));
}
const damaged={...inputs,annotation:new ObservedBlob([new Uint8Array(sources[0].bytes)])};let accepted=0,written=0;
await assert.rejects(()=>buildOfficial(damaged,sourceManifest,{},()=>written++,()=>{},()=>accepted++),e=>e.sourceId==='annotation'&&/SHA-256 mismatch/.test(e.message));
assert.equal(accepted,0);assert.equal(written,0);assert.equal(damaged.annotation.bytesRead,sources[0].bytes);
await assert.rejects(()=>verifyOfficialInputs({...inputs,annotation:new ObservedBlob([new Uint8Array(60)])},sourceManifest),/length\/SHA-256 mismatch/);
console.log('One bounded full scan per source; same-size damage and truncated inputs cannot become checked models');
