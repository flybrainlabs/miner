import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Directory } from './opfs_fixture.mjs';
import { CandidateStoreV2 } from '../web/candidate-store-v2.mjs';
import { retainOutput,retainedOutputs,retainedCandidateOutputs,releaseOutput } from '../web/pending-output.mjs';
import { buildRecord,jsonBytes } from '../web/response-record.mjs';
import { targetRecord,validateTargetRecord } from '../web/target-response-record.mjs';
import { trialTask,inputs,candidateId,evaluate } from '../web/target-protocol-v2.mjs';
const v=JSON.parse(readFileSync('tests/vectors/target-v2.json')),cfg=JSON.parse(readFileSync('web/data/research-profiles/duration256-v1-dev/config.json'));
let blocked=false;const disk=new Directory('',path=>blocked&&path.includes('flypow-candidates-')&&path.endsWith('/state.json'));
Object.defineProperty(globalThis,'navigator',{value:{storage:{getDirectory:async()=>disk}},configurable:true});
const network={networkId:v.round.pre.networkId,authorityId:v.round.pre.authorityId};let store=new CandidateStoreV2(network);store.config=cfg;
const results=[],metas=[];
for(const input of inputs(v.goal).slice(0,2)){
  const task=await trialTask(v.round,input,0),meta=await store.begin(v.round,input,await candidateId(v.round.roundId,input)),bytes=new Uint8Array(480),view=new DataView(bytes.buffer);bytes.set(new TextEncoder().encode('FBRP1\0\0\0'));for(const [at,n]of [[8,cfg.neuron_count],[12,task.targetIndex],[16,256]])view.setUint32(at,n,true);
  const bundle=await targetRecord(await buildRecord(bytes,cfg,task,b=>v.goal.stimulusSet.find(x=>x.bodyId===b.toString()).modelIndex),task,v.round);
  const trace={schema:'synthetic-recovery-trace-test',executionId:crypto.randomUUID()};const result={...bundle,task,config:cfg,archive:new Blob([bytes]),responseBytes:480,resultHash:bundle.resultRoot,goalMetrics:await evaluate(v.goal,input,bytes),temporary:crypto.randomUUID()+'.bin',trace,traceBytes:jsonBytes(trace).buffer};
  const dir=await disk.getDirectoryHandle('flypow-result-staging-v1',{create:true}),file=await dir.getFileHandle(result.temporary,{create:true}),w=await file.createWritable();await w.write(bytes);await w.close();await retainOutput(result,{executionId:crypto.randomUUID()});results.push(result);metas.push(meta);
}
// Both full outputs have durable staging metadata before storage/UI notification.
blocked=true;for(let i=0;i<2;i++){await assert.rejects(store.saveTrial(metas[i],results[i]),{name:'QuotaExceededError'});assert.equal(metas[i].trials.length,0,'failed metadata commit cannot mutate saved state');}assert.equal((await retainedOutputs()).length,2);
assert.equal((await retainedCandidateOutputs(network,store)).length,2);
assert.equal((await retainedCandidateOutputs({...network,authorityId:'f'.repeat(64)},store)).length,0);
assert.equal((await retainedCandidateOutputs({...network,networkId:'different-dev-network'},store)).length,0);
assert.equal((await retainedOutputs()).length,2,'Namespace filtering must never delete another network\'s unique output');
// New store instances model a refresh: no latest pointer or old memory is used.
blocked=false;store=new CandidateStoreV2(network);store.config=cfg;
for(const r of await retainedOutputs()){
  assert(r.traceBytes&&r.trace,'optional display trace survives failed save and refresh');const meta=await store.metadata(r.task.candidateId);await store.saveTrial(meta,r);const saved=await store.bundle(meta);assert.equal(saved.resultHash,r.resultHash);assert.equal(saved.record.schema,'flypow-target-response-record-v2');assert.deepEqual(new Uint8Array(await saved.archive.arrayBuffer()),new Uint8Array(await r.archive.arrayBuffer()));assert.deepEqual(saved.trace,r.trace);await releaseOutput(r.temporary);
  const legacy={...r.record,schema:'flypow-response-record-v2',v2:Object.fromEntries(['roundId','goalId','candidateId','trialId','repeatIndex'].map(k=>[k,r.record[k]]))};for(const k of ['protocolVersion','roundId','goalId','candidateId','trialId','repeatIndex','seedHex','input','parameterProfileHash'])delete legacy[k];
  assert.equal(validateTargetRecord(legacy,meta,meta.trials[0],r.task).compatibility,'nested-development-v2');assert.throws(()=>validateTargetRecord({...legacy,v2:{...legacy.v2,roundId:'0'.repeat(64)}},meta,meta.trials[0],r.task));
  const directory=await(await store.candidate(meta.candidateId)).getDirectoryHandle(meta.trials[0].trialId),h=await directory.getFileHandle('preview.json'),w=await h.createWritable();await w.write(jsonBytes({...r.preview,result_root:'0'.repeat(64)}));await w.close();await assert.rejects(store.bundle(meta),/preview binding/);
}
assert.equal((await retainedOutputs()).length,0);assert.equal((await store.list()).length,2);
console.log('V2 multiple durable save failures, refresh/retry/export bytes, separate wrappers, legacy nested binding and damaged side-file rejection passed (synthetic silent archives).');
