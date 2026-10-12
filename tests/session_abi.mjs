// Real three-cell WASM, with exact observation/ownership semantics, no animation mocks.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { selectSubnetwork, decodeTraceRows, traceTransfers, TraceIndex } from '../web/propagation-trace.mjs';
let samples=[];const {instance}=await WebAssembly.instantiate(await readFile('web/wasm/flypow_sim_core.wasm'),{flypow:{progress:(...v)=>samples.push(v)}}),e=instance.exports;
const graph=new Uint8Array(124),v=new DataView(graph.buffer);graph.set(new TextEncoder().encode('FBGR1\0\0\0'));v.setUint32(8,3,true);v.setBigUint64(12,2n,true);graph.fill(1,20,52);
for(let i=0;i<3;i++)v.setBigUint64(52+i*8,BigInt(i+1),true);for(const [i,value]of [0,1,2,2].entries())v.setBigUint64(76+i*8,BigInt(value),true);v.setUint32(108,1,true);v.setUint32(112,100,true);v.setUint32(116,2,true);v.setUint32(120,100,true);
const model=new Uint8Array(56);model.set(new TextEncoder().encode('FBMD1\0\0\0'));new DataView(model.buffer).setUint32(8,3,true);model.set(createHash('sha256').update(graph).digest(),12);model.fill(1,44,47);
const load=bytes=>{const p=e.flypow_alloc(bytes.length);assert(p);new Uint8Array(e.memory.buffer,p,bytes.length).set(bytes);return p;},gp=load(graph),mp=load(model),handle=e.flypow_model_open(gp,124,mp,56);assert(handle);
const selected=load(new Uint8Array(new Uint32Array([0,1,2]).buffer)),out=e.flypow_alloc(2048);
const begin=(options={})=>e.flypow_session_begin(handle,1n,32,options.observe||0,options.version||1,options.start||0,options.end||1,200n,1n,options.cap||134217728,options.trace===false?0:selected,options.trace===false?0:3);
assert.equal(begin({version:2}),0);assert.equal(begin({observe:1}),0);
let first;
for(const budget of [1,11,65536]){
  samples=[];const session=begin({trace:budget!==11});assert(session);assert.equal(e.flypow_model_close(handle),0);assert.equal(e.flypow_session_output_length(session),0);
  assert([1,2].includes(e.flypow_session_advance(session,budget)));if(budget===1)assert.equal(samples.at(-1)[0],0);
  // Detached JS views after memory.grow are never reused by the ABI or reader.
  const old=new Uint8Array(e.memory.buffer,gp,124);e.memory.grow(1);assert.equal(old.byteLength,0);
  let status=1;while(status===1)status=e.flypow_session_advance(session,budget);assert.equal(status,2);
  const length=e.flypow_session_output_length(session),bytes=new Uint8Array(length);
  for(let at=0;at<length;at+=13){const count=e.flypow_session_read_output(session,at,out,Math.min(13,length-at));bytes.set(new Uint8Array(e.memory.buffer,out,count),at);}
  if(first)assert.deepEqual(bytes,first);else first=bytes;
  assert.equal(samples.at(-1)[2],192n);
  if(budget!==11){const count=e.flypow_session_read_trace(session,0,out,18),rows=decodeTraceRows(new Uint8Array(e.memory.buffer,out,count*72));assert.equal(rows.length,18);assert.deepEqual(rows.filter(r=>r[2]===1&&r[3]).map(r=>[r[0],r[1]]),[[0,0],[1,1],[2,2]]);const subnet=selectSubnetwork(v,new DataView(model.buffer),3,0,{cells:3,edges:2}),trace={...subnet,states:rows,steps:32};trace.transfers=traceTransfers(trace);const index=new TraceIndex(trace);assert.equal(index.frame(.5).moving[0][5],1);assert.equal(index.frame(1).arrived[0][3],1);assert.equal(index.frame(1).states[1].lanes[0].row[3],true);}
  e.flypow_session_free(session);
}
const interrupted=begin();e.flypow_session_advance(interrupted,1);assert.equal(e.flypow_session_output_length(interrupted),0);e.flypow_session_free(interrupted);
const capped=begin({cap:480});let status=1;while(status===1)status=e.flypow_session_advance(capped,5);assert.equal(status,0);assert.equal(e.flypow_session_error(capped),1);assert.equal(e.flypow_session_output_length(capped),0);e.flypow_session_free(capped);
assert.equal(e.flypow_model_close(handle),1);for(const [p,size]of [[gp,124],[mp,56],[selected,12],[out,2048]])e.flypow_free(p,size);
console.log('Actual three-cell WASM chain, s→s+1 propagation, slices/trace invariance, model ownership, memory.grow, partial cancel and output cap passed.');
