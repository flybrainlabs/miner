// Coordinator faults only. Scientific replay evidence lives in target_competition_v2.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GoalSearchRunner } from '../web/goal-search-runner.mjs';
import { ComputePool } from '../web/compute-pool.mjs';
import { createMinerState } from '../web/miner-state.mjs';
import { canonical,candidateId } from '../web/target-protocol-v2.mjs';
const vector=JSON.parse(fs.readFileSync('tests/vectors/target-v2.json')),config=JSON.parse(fs.readFileSync('web/data/research-profiles/duration256-v1-dev/config.json'));
Object.defineProperty(globalThis,'navigator',{value:{locks:{request:async(_,opts,fn)=>fn({})},storage:{estimate:async()=>({quota:20e9,usage:0})}},configurable:true});globalThis.document={hidden:false};globalThis.localStorage={setItem(){},getItem(){return null;}};
const until=async fn=>{for(let i=0;i<1000;i++){if(fn())return;await new Promise(r=>setTimeout(r,1));}throw new Error('Coordinator timeout');};
class Runtime {
  constructor(workerId='compute-primary'){this.workerId=workerId;this.ready=true;this.controls=[];this.seq=0;}
  request(type,data){if(type==='restore'){this.ready=true;return Promise.resolve({});}assert.equal(type,'run');this.data=data;return new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});}
  message(extra={}){const d=this.data;return {networkId:this.data.networkId||'local-tools',roundId:this.data.task.roundId||'',sequence:++this.seq,producedAt:performance.now(),workerId:this.workerId,sessionId:d.sessionId,executionId:d.executionId,operationId:d.operationId,taskId:d.task.taskId,stage:'simulation',completedSteps:8,neuronUpdates:2641952,synapseTransmissions:1000,...extra};}
  trace(){this.onLive(this.message({sequence:0,rows:new ArrayBuffer(0)}));}
  observe(scope,on){this.observation={scope,on};}
  control(action){this.controls.push(action);if(action==='cancel')this.reject(Object.assign(new Error('Safe cancellation'),{code:'paused',computation:this.message(this.cancelCounts||{})}));else queueMicrotask(()=>this.onControl(this.message({state:action==='pause'?'paused':'running',telemetry:this.message({stage:action==='pause'?'paused':'simulation'})})));}
  complete(passed=false){this.resolve({task:this.data.task,responseBytes:480,resultHash:this.data.task.trialId,goalMetrics:{passed},computation:this.message({stage:'results',completedSteps:256}),traceBytes:new ArrayBuffer(0)});}
  release(){this.ready=false;}
}
function setup({displayFailure=false,saveFailure=false}={}){
  const round=structuredClone(vector.round);round.pre.claimDeadline=10000;const primary=new Runtime(),pool=new ComputePool(primary,{policy:{max:2,defaultThreads:2},createRuntime:id=>new Runtime(id)}),state=createMinerState(),rows=new Map(),saved=[],seen=[],submitted=[];
  const client={network:{networkId:round.pre.networkId,authorityId:round.pre.authorityId,campaignId:round.pre.campaignId},identity:{publicKey:'b'.repeat(64)},online:true,round,serverNow:1,sync:async()=>{if(!client.online)throw new Error('Authority unavailable');return {round:client.round};},heartbeat:async()=>{}};
  const store={cursor:async()=>({visited:[],cursor:0}),saveCursor:async()=>{},list:async()=>[...rows.values()],begin:async(r,input,candidateId)=>{const m={round:r,roundId:r.roundId,goalId:r.pre.goalId,input,candidateId,trials:[],partial:true,phase:'computing'};rows.set(candidateId,m);return m;},update:async m=>rows.set(m.candidateId,m),metadata:async id=>rows.get(id),saveTrial:async(m,r)=>{if(saveFailure)throw new Error('Injected save failure');saved.push(r);m.trials.push({trialId:r.task.trialId,repeatIndex:r.task.repeatIndex,metrics:r.goalMetrics});}};
  const phases=[];state.subscribe(s=>phases.push(s.execution.phase));const live=[];const runner=new GoalSearchRunner({runtime:primary,pool,config,state,client,store,submission:{submit:async id=>submitted.push(id)},onFocus:scope=>{if(scope)seen.push(scope.executionId);},onSnapshot:m=>live.push(m.executionId),onResult:async()=>{if(displayFailure)throw new Error('Injected UI error');}});return {runner,pool,primary,client,rows,saved,seen,submitted,state,live,phases,restoreSaving:()=>{saveFailure=false;},store};
}
async function start(x){await x.runner.start({minutes:10,storageBytes:2e9});await until(()=>x.runner.active.length===2&&x.runner.active.every(e=>e.slot.runtime.data));}
async function end(x){x.runner.stopNow();await x.runner.completion;assert(x.primary.ready,'routine cancellation retains the cached model');}
{
 const x=setup();await x.runner.prepareRound(x.client.round);const input=x.runner.order.at(0),id=await candidateId(x.client.round.roundId,input),failed={candidateId:id,roundId:x.client.round.roundId,round:x.client.round,input:JSON.parse(new TextDecoder().decode(canonical(input))),phase:'candidate-failed-science',partial:false,trials:[{repeatIndex:0,metrics:{passed:false}}]};x.rows.set(id,failed);await start(x);assert(x.runner.active.every(e=>e.meta.candidateId!==id),'canonical object field order cannot make a failed input eligible again');assert.equal(failed.trials.length,1);assert.equal(failed.trials[0].metrics.passed,false);await end(x);
}
{
 const x=setup();const hold=[];x.runner.store.saveTrial=async(m,r)=>{await new Promise(resolve=>hold.push(resolve));x.saved.push(r);m.trials.push({trialId:r.task.trialId,repeatIndex:r.task.repeatIndex,metrics:r.goalMetrics});};await start(x);assert(x.phases.includes('selecting'),'an empty starting pool is selecting, never saving');const [a,b]=x.runner.active;a.slot.runtime.complete(false);await until(()=>hold.length===1);assert.equal(x.runner.snapshot().phase,'computing-background','one saving result cannot hide another actual running Worker');b.slot.runtime.complete(false);await until(()=>hold.length===2);assert.equal(x.state.value.execution.phase,'saving','both real coordinator results may wait for durable storage without invalid UI state');assert.equal(x.saved.length,0);assert.equal(x.runner.snapshot().phase,'evaluating-and-saving','all actual saving slots control the published phase');x.runner.pauseNow();for(const resolve of hold)resolve();await until(()=>!x.runner.active.length);assert.equal(x.saved.length,2);await end(x);
}
{
 const x=setup({displayFailure:true});await start(x);const [a,b]=x.runner.active;a.slot.runtime.trace();b.slot.runtime.trace();x.runner.focus(a.id);x.runner.pauseNow();await until(()=>x.runner.paused);a.slot.runtime.complete(false);await until(()=>a.done);assert.equal(x.runner.focusedExecutionId,b.id);assert(x.seen.includes(b.id));assert.equal(a.traceMessages,undefined);assert.equal(x.saved.length,1);assert(x.primary.ready);assert(!b.done);
 x.runner.setThreads(1);await x.runner.resume({minutes:12,storageBytes:2e9});assert.equal(x.runner.budget.minutes,12);await until(()=>b.slot.status==='running');const received=x.live.length;for(let i=0;i<20;i++)x.runner.focus(b.id);assert.equal(b.traceMessages,undefined);assert.equal(b.slot.runtime.observation.on,true);b.slot.runtime.onLive({...b.slot.runtime.message(),executionId:'late-old'});assert.equal(x.live.length,received);await end(x);
}
{
 const x=setup({saveFailure:true});await start(x);x.runner.pauseNow();await until(()=>x.runner.paused);for(const e of x.runner.active)e.slot.runtime.complete(false);await until(()=>!x.runner.active.length);assert.equal(x.runner.pendingResults.size,2);assert.equal(x.runner.budget.reservedBytes,0);assert(x.runner.budget.stagingBytes>0,'retained staging consumes the common budget');assert.equal(x.runner.budget.savedBytes,0);await end(x);
}
{
 const x=setup();await start(x);const old=x.client.round.roundId,[a,b]=x.runner.active;a.slot.runtime.complete(true);await until(()=>a.j===1&&a.slot.runtime.data.task.repeatIndex===1);assert.equal(a.meta.trials.length,1,'only full A/B backgrounds can be early-stop boundaries');
 const next=structuredClone(vector.round);next.roundId='c'.repeat(64);next.pre.claimDeadline=20000;x.client.round=next;x.runner.syncRound({round:next,state:'RUNNING_DEV_NO_PAYMENT'});await until(()=>x.runner.round.roundId===next.roundId&&x.runner.active.length===2&&x.runner.active.every(e=>e.slot.runtime.data.task.roundId===next.roundId));assert.equal(a.meta.trials.length,1);assert.equal(a.meta.phase,'partial-trial-interrupted');assert(x.pool.primary.ready);const ids=x.runner.active.map(e=>e.id);x.runner.roundEvent({kind:'ROUND_FINALIZED',roundId:old});assert.deepEqual(x.runner.active.map(e=>e.id),ids,'old close cannot cancel new round');assert.equal(x.runner.budget.completedCandidates,0);await end(x);
}
{
 const x=setup();await start(x);x.runner.pauseNow();await until(()=>x.runner.paused);x.client.online=false;await assert.rejects(x.runner.resume({minutes:12,storageBytes:2e9}),/Authority unavailable/);x.runner.disconnected(new Error('Connection lost'));assert(x.runner.paused);x.client.online=true;await x.runner.resume({minutes:12,storageBytes:2e9});await until(()=>x.runner.active.some(e=>e.slot.status==='running'));globalThis.document.hidden=true;x.runner.visibility();await until(()=>x.runner.paused);globalThis.document.hidden=false;assert(x.runner.paused,'returning foreground never restarts CPU');await end(x);
}
{
 const x=setup();await start(x);const [a,b]=x.runner.active;
 a.slot.runtime.complete(true);await until(()=>a.j===1&&a.slot.runtime.data.task.repeatIndex===1);
 const candidate=a.meta.candidateId,firstTrial=a.meta.trials[0].trialId;
 a.slot.runtime.reject(new Error('Injected Worker crash after one durable background'));await until(()=>a.done&&x.runner.paused);
 assert.equal(a.meta.phase,'partial-trial-interrupted');assert.equal(a.meta.trials.length,1);assert(!b.done,'healthy work is retained at its pause boundary');
 assert(x.runner.resumable.some(m=>m.candidateId===candidate));
 await x.runner.resume();await until(()=>x.runner.active.some(e=>e.meta.candidateId===candidate&&e.slot.runtime.data.task.repeatIndex===1));
 const restored=x.runner.active.find(e=>e.meta.candidateId===candidate);assert.equal(restored.meta.trials[0].trialId,firstTrial);assert.equal(x.saved.filter(r=>r.task.trialId===firstTrial).length,1,'durable background is neither recomputed nor counted as new saved work');
 assert(x.primary.ready,'failed primary restores from the retained model before dispatch');// Stop while the resumed task hash is still resolving; no new request may escape.
 await end(x);
}
{
 const x=setup();const reports=[];let backpressure=true;
 x.client.reportWork=async report=>{reports.push(structuredClone(report));if(report.phase==='ended'&&backpressure){backpressure=false;throw Object.assign(new Error('Telemetry minimum interval'),{code:'BACKPRESSURE'});}};
 await start(x);const [a,b]=x.runner.active;
 a.slot.runtime.onCompute(a.slot.runtime.message({workNeuronUpdates:'25',workSynapseAdditions:'1'}));
 a.slot.runtime.cancelCounts={workNeuronUpdates:'40',workSynapseAdditions:'3'};b.slot.runtime.cancelCounts={workNeuronUpdates:'17',workSynapseAdditions:'2'};
 const session=x.runner.budget.sessionId;await end(x);
 assert.equal(x.runner.totals().neurons,'57','cancellation completes missing partial work without a final progress message');assert.equal(x.runner.totals().synapses,'5');assert.equal(x.runner.meter.inflight.size,0);
 const total=x.runner.totals();x.runner.failed(a,Object.assign(new Error('Duplicate stopped result'),{code:'paused',computation:a.slot.runtime.message({workNeuronUpdates:'999'})}));assert.deepEqual(x.runner.totals(),total);
 assert.equal(x.saved.length,0,'stopped work is observational only, never a complete scientific artifact');
 const ended=reports.find(r=>r.phase==='ended');assert.equal(ended.neuronUpdates,'57');assert.equal(ended.sessionId,session);
 await start(x);assert.notEqual(x.runner.budget.sessionId,session);x.runner.meter.reset();await end(x);
 await new Promise(resolve=>setTimeout(resolve,2300));const old=reports.filter(r=>r.phase==='ended'&&r.sessionId===session);assert.equal(old.length,2);assert.deepEqual(old[0],old[1],'bounded retry retains the old session payload after a new start');
}
console.log('V2 coordinator paths: two Workers/focus, UI isolation, save failures, budgets, all-pass boundary, safe cross-round cancellation, stale events, reconnect and crash recovery from durable background prefixes passed (runtime faults simulated).');

// Recovering a complete first passing background must re-enter the same running
// session's queue. A stop/start would mask the original defect.
{
 const x=setup({saveFailure:true});await start(x);x.runner.pauseNow();await until(()=>x.runner.paused);const original=x.runner.active[0],candidate=original.meta.candidateId;for(const e of x.runner.active)e.slot.runtime.complete(true);await until(()=>!x.runner.active.length);
 const result=[...x.runner.pendingResults.values()].find(r=>r.task.candidateId===candidate);assert(result);x.restoreSaving();const meta=x.rows.get(candidate);await x.store.saveTrial(meta,result);meta.partial=true;meta.phase='partial-trial-interrupted';assert.equal(meta.trials.length,1);assert(x.runner.recoverCandidate(meta));assert(x.runner.recoverCandidate(meta));assert.equal(x.runner.resumable.filter(m=>m.candidateId===candidate).length,1);
 await x.runner.resume();await until(()=>x.runner.active.some(e=>e.meta.candidateId===candidate&&e.slot.runtime.data?.task.repeatIndex===1));const continuation=x.runner.active.find(e=>e.meta.candidateId===candidate);assert.equal(continuation.meta.input,meta.input);continuation.slot.runtime.complete(true);await until(()=>x.submitted.includes(candidate));assert.equal(x.rows.get(candidate).trials.length,2);assert(x.runner.running);await end(x);
}
console.log('Recovered first passing background resumes the same candidate/session through background 2 (coordinator fault fixture).');
{
 const x=setup(),errors=[];x.runner.financial={requireFunding:async()=>({wallet:'fixture-wallet',grant:'fixture-grant',generation:'1'}),reportAttempt:async()=>{throw Object.assign(new Error('Gateway temporarily unavailable'),{code:'GATEWAY_RETRY'});}};x.runner.onError=e=>errors.push(e);
 await x.runner.start({minutes:10,storageBytes:2e9});await until(()=>x.runner.paused);assert.equal(x.runner.pauseReason,'network');assert.equal(errors.length,1);assert.equal(errors[0].code,'GATEWAY_RETRY');assert.equal(x.runner.active.length,0);assert.equal(x.saved.length,0);assert(!x.primary.data,'admission failure cannot dispatch a Worker');assert.equal(x.rows.size,1,'candidate recovery metadata is retained');const candidate=[...x.rows.keys()][0];assert.equal(x.runner.resumable[0].candidateId,candidate);x.runner.financial.reportAttempt=async()=>{};await x.runner.resume();await until(()=>x.runner.active.length===2&&x.runner.active.every(e=>e.slot.runtime.data));assert.equal(x.runner.active[0].meta.candidateId,candidate,'explicit retry dispatches the selected candidate instead of skipping its input');await end(x);
}
console.log('Gateway admission faults retain candidate metadata, surface diagnostics and never masquerade as rent-credit failure.');
{
 const x=setup(),errors=[];let admissions=0;const scope={wallet:'fixture-wallet',grant:'fixture-grant',generation:'1'};x.runner.financial={requireFunding:async()=>{if(++admissions===1)return scope;throw Object.assign(new Error('Wallet RPC rate limited'),{code:'RPC_RATE_LIMITED'});},reportAttempt:async()=>{}};x.runner.onError=e=>errors.push(e);
 await x.runner.start({minutes:10,storageBytes:2e9});await until(()=>x.runner.paused);assert.equal(x.runner.pauseReason,'network');assert.equal(errors[0].code,'RPC_RATE_LIMITED');assert(!x.primary.data);assert.equal(x.saved.length,0);const meta=[...x.rows.values()][0],input=structuredClone(meta.input);assert.equal(x.runner.resumable[0].candidateId,meta.candidateId);
 x.runner.financial.requireFunding=async()=>({wallet:'fixture-wallet',grant:'fixture-grant',generation:'1'});await x.runner.resume();await until(()=>x.runner.active.length===2&&x.runner.active.every(e=>e.slot.runtime.data));assert.equal(x.runner.active[0].meta.candidateId,meta.candidateId);assert.deepEqual(x.runner.active[0].meta.input,input);await end(x);
}
console.log('RPC 429 before Worker dispatch retains the same candidate/input for explicit retry without executing or saving a fabricated computation.');
