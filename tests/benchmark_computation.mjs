// Same machine, same input, balanced old/new WASM trials. This measures the
// synchronous core + observed import, not page rendering, storage or peak RAM.
import assert from 'node:assert/strict';
import { readFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const [baselinePath,currentPath,graphPath,modelPath]=process.argv.slice(2);
if(!modelPath)throw new Error('usage: node tests/benchmark_computation.mjs OLD.wasm NEW.wasm GRAPH.bin MODEL.bin');
async function load(e,path){const file=await open(path);try{const size=(await file.stat()).size,p=e.flypow_alloc(size),chunk=Buffer.allocUnsafe(4*1024*1024);let at=0;while(at<size){const {bytesRead}=await file.read(chunk,0,Math.min(chunk.length,size-at),at);assert(bytesRead);new Uint8Array(e.memory.buffer,p+at,bytesRead).set(chunk.subarray(0,bytesRead));at+=bytesRead;}return {p,size};}finally{await file.close();}}
const models=[];
for(const path of [baselinePath,currentPath]){
 let samples=0;const {instance}=await WebAssembly.instantiate(await readFile(path),{flypow:{progress(){samples++;}}});
 const e=instance.exports;models.push({e,graph:await load(e,graphPath),model:await load(e,modelPath),length:e.flypow_alloc(4),count:()=>samples});
}
const trials=[];
for(const [round,order]of [[-1,[0,1]],[0,[0,1]],[1,[1,0]],[2,[0,1]]])for(const index of order){
 const {e,graph:g,model:m,length,count}=models[index],before=count(),at=performance.now();
 const p=e.flypow_run(g.p,g.size,m.p,m.size,16789n,32,4,12,200n,0x4c4f43414c5f7630n,length),ms=performance.now()-at;assert(p);
 const size=new DataView(e.memory.buffer).getUint32(length,true),hash=createHash('sha256').update(new Uint8Array(e.memory.buffer,p,size)).digest('hex');
 assert.equal(hash,'b8d4e5f06df579a39272df9e79faa499899cf30f9b10ff4ad425eb5a7e100a5d');
 assert.equal(count()-before,index?33:0);e.flypow_free(p,size);
 if(round>=0)trials.push({round,kind:index?'observed':'baseline',ms});
}
const median=kind=>trials.filter(r=>r.kind===kind).map(r=>r.ms).sort((a,b)=>a-b)[1],baseline=median('baseline'),observed=median('observed');
console.log(JSON.stringify({schema:'flypow-computation-benchmark-v1',scope:'balanced single-machine WASM core plus import; excludes UI/storage; no speed guarantee',trials,baselineMedianMs:baseline,observedMedianMs:observed,changePercent:100*(observed/baseline-1),allResultsMatchNative:true}));
for(const {e,graph:g,model:m,length}of models){e.flypow_free(g.p,g.size);e.flypow_free(m.p,m.size);e.flypow_free(length,4);}
