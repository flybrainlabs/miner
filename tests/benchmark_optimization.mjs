// Real frozen full model; timings are measurements, never task requirements.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, open, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { taskForIndex, checkCatalog } from '../web/catalog-task.mjs';
import { selectSubnetwork, traceIdentity, decodeTraceRows, traceTransfers, validateTrace, traceSideFile } from '../web/propagation-trace.mjs';
import { buildRecordFile } from '../web/response-record.mjs';
const [out='data/prepared/optimization-benchmarks']=process.argv.slice(2);await mkdir(out,{recursive:true});
const graphPath='data/prepared/registry-male-cns-v1.0/graph-v1.bin',modelPath='data/prepared/registry-male-cns-v1.0/model-v0.bin';
let counts=[];const {instance}=await WebAssembly.instantiate(await readFile('web/wasm/flypow_sim_core.wasm'),{flypow:{progress:(...v)=>counts.push(v)}}),e=instance.exports;
async function load(path){const f=await open(path);try{const size=(await f.stat()).size,p=e.flypow_alloc(size),chunk=Buffer.allocUnsafe(4*1024*1024);assert(p);for(let at=0;at<size;){const {bytesRead}=await f.read(chunk,0,Math.min(chunk.length,size-at),at);assert(bytesRead);new Uint8Array(e.memory.buffer,p+at,bytesRead).set(chunk.subarray(0,bytesRead));at+=bytesRead;}return {p,size};}finally{await f.close();}}
const loadedAt=performance.now(),g=await load(graphPath),m=await load(modelPath),handle=e.flypow_model_open(g.p,g.size,m.p,m.size);assert(handle);const loadMs=performance.now()-loadedAt;
const chunkSize=4*1024*1024,output=e.flypow_alloc(chunkSize),selectionPointer=e.flypow_alloc(64*4),tracePointer=e.flypow_alloc(2048*72);assert(output&&selectionPointer&&tracePointer);
const report={schema:'flypow-optimization-benchmark-v1',environment:{platform:process.platform,arch:process.arch,node:process.version,cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length,totalRAMBytes:os.totalmem()},memoryScope:'WASM linear-memory capacity; native/reference process RSS measured separately, no browser RAM inference',modelOpenCount:1,modelLoadAndValidateMs:loadMs,samples:[]};
for(const [profile,configPath,catalogPath,cases]of [
  ['quick32','web/data/research-config.json','web/data/task-catalog-dev.json',[124]],
  ...[128,256,512].map(s=>[`duration${s}-v1-dev`,`web/data/research-profiles/duration${s}-v1-dev/config.json`,`web/data/research-profiles/duration${s}-v1-dev/catalog.json`,[0,124,200]])]){
  const config=JSON.parse(await readFile(configPath)),catalog=await checkCatalog(new Uint8Array(await readFile(catalogPath)),config);
  for(const k of cases){
    const task=await taskForIndex(catalog,k),subnet=selectSubnetwork(new DataView(e.memory.buffer,g.p,g.size),new DataView(e.memory.buffer,m.p,m.size),config.neuron_count,task.targetIndex);
    for(const round of profile==='quick32'?[0,1]:[0,1]){
      counts=[];const traceEnabled=round===0,selected=traceEnabled?subnet.selection:[],trace=traceIdentity(config,task,`${profile}/${k}/${round}`,subnet);
      new Uint32Array(e.memory.buffer,selectionPointer,selected.length).set(selected);
      const session=e.flypow_session_begin(handle,BigInt(task.bodyId),config.steps,0,1,task.stimulus.start_step,task.stimulus.end_step,BigInt(task.stimulus.current),task.seed,config.max_archive_bytes||134217728,selectionPointer,selected.length);assert(session);
      assert.equal(e.flypow_model_close(handle),0,'input model cannot close with live borrowed state');
      const started=performance.now();let status=1,slices=0,maxSliceMs=0;
      while(status===1){const at=performance.now();status=e.flypow_session_advance(session,round?65536:8192);maxSliceMs=Math.max(maxSliceMs,performance.now()-at);slices++;}
      const simulationMs=performance.now()-started,last=counts.at(-1),sample={profile,k,round,stimulus:task.stimulus,seedHex:task.seed.toString(16),taskId:task.taskId,traceEnabled,sliceBudget:round?65536:8192,slices,maxSliceMs,simulationMs,completedSteps:last[0],neuronUpdates:String(last[2]),synapseTransmissions:String(last[3]),spikesA:String(last[4]),spikesB:String(last[5]),wasmCapacityBytes:e.memory.buffer.byteLength};
      if(status===0){assert.equal(e.flypow_session_error(session),1);sample.resourceFailure='Frozen 128 MiB scientific archive cap; no truncated result';report.samples.push(sample);e.flypow_session_free(session);continue;}
      assert.equal(last[0],config.steps);assert.equal(last[2],BigInt(config.steps)*BigInt(config.neuron_count)*2n);assert.equal(counts.length,config.steps+1);
      const filePath=`${out}/${profile}-${k}-${round}.bin`,writer=await open(filePath,'w'),hash=createHash('sha256'),length=e.flypow_session_output_length(session),saveAt=performance.now();
      try{for(let at=0;at<length;at+=chunkSize){const count=e.flypow_session_read_output(session,at,output,Math.min(chunkSize,length-at));assert(count);const bytes=new Uint8Array(e.memory.buffer,output,count);hash.update(bytes);await writer.write(bytes);}}finally{await writer.close();}
      Object.assign(sample,{archiveBytes:length,resultHash:hash.digest('hex'),streamAndFilesystemSaveMs:performance.now()-saveAt,archivePath:filePath});
      if(round){assert.equal(sample.resultHash,report.samples.at(-1).resultHash,'trace toggle and slice sizes cannot alter output');}
      if(profile==='quick32')assert.equal(sample.resultHash,'6fb503749865cfe4419a633d1652d109cf216e1c79ef7ae0e22d0f990680c9a0');
      if(traceEnabled){let at=0,total=e.flypow_session_trace_count(session);assert.equal(total,subnet.cells.length*config.steps*2);while(at<total){const n=e.flypow_session_read_trace(session,at,tracePointer,2048);assert(n);trace.states.push(...decodeTraceRows(new Uint8Array(e.memory.buffer,tracePointer,n*72)));at+=n;}trace.transfers=traceTransfers(trace);trace.coverage.lastStep=config.steps-1;trace.coverage.complete=true;trace.resultRoot=sample.resultHash;validateTrace(trace,config,task,sample.resultHash);const side=await traceSideFile(trace);sample.traceBytes=side.bytes.length;sample.visibleTransfers=trace.transfers.length;await writeFile(`${out}/${profile}-${k}-trace.json`,side.bytes);
        // Verify propagation work independently using event indices and CSR degrees.
        const data=await readFile(filePath),view=new DataView(e.memory.buffer),offset=g.p+52+config.neuron_count*8;let additions=0n;
        for(let at=480;at<data.length;at+=8){const i=data.readUInt32LE(at+4);additions+=view.getBigUint64(offset+(i+1)*8,true)-view.getBigUint64(offset+i*8,true);}assert.equal(additions,last[3]);
        const decodeAt=performance.now(),record=await buildRecordFile(new Blob([data]),config,task,body=>{const v=new DataView(e.memory.buffer,g.p,g.size);let lo=0,hi=config.neuron_count;while(lo<hi){const mid=(lo+hi)>>1;if(v.getBigUint64(52+mid*8,true)<body)lo=mid+1;else hi=mid;}return lo;},sample.resultHash);sample.boundedDecodeMs=performance.now()-decodeAt;sample.summary=record.record.summary;
      }
      e.flypow_session_free(session);
      if(round===0){const nativeAt=performance.now(),native=spawnSync('target/release/verify_response',[graphPath,modelPath,catalogPath,String(k),filePath],{encoding:'utf8'});assert.equal(native.status,0,native.stderr);sample.fullNativeVerifyMs=performance.now()-nativeAt;sample.nativeVerification=native.stdout.trim();}
      report.samples.push(sample);await writeFile(`${out}/report.json`,JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');console.log(JSON.stringify({profile,k,round,simulationMs,bytes:length,hash:sample.resultHash}));
    }
  }
}
assert.equal(e.flypow_model_close(handle),1);for(const [p,size]of [[g.p,g.size],[m.p,m.size],[output,chunkSize],[selectionPointer,64*4],[tracePointer,2048*72]])e.flypow_free(p,size);
await writeFile(`${out}/report.json`,JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');console.log('Reusable model, real slices, core traces, scientific counters and complete native verification passed.');
