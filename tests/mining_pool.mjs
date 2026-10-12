// Coordinator faults are simulated here; real Worker/WASM overlap is checked in E2E.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TaskRunner } from '../web/task-runner.mjs';
import { ComputePool,computePolicy } from '../web/compute-pool.mjs';
import { createMinerState } from '../web/miner-state.mjs';
import { compactNumber } from '../web/metric-format.mjs';
import { ReplayController } from '../web/replay-controller.mjs';
import { validateAnatomyIndex } from '../web/anatomy-assets.mjs';
const cfg=JSON.parse(fs.readFileSync('web/data/research-profiles/duration256-v1-dev/config.json')),catalog=JSON.parse(fs.readFileSync('web/data/research-profiles/duration256-v1-dev/catalog.json'));
const values=[[980,'980'],[12340,'12.34 k'],[1234567,'1.23 M'],[1234567890,'1.23 G'],[1234567890000,'1.23 T'],[999999,'1 M'],[0,'0'],[NaN,'—'],[Infinity,'—'],[null,'—']];for(const [n,s]of values)assert.equal(compactNumber(n).text,s);
assert.equal(compactNumber(900719925474099312345n).exact,'900,719,925,474,099,312,345');
assert.equal(computePolicy({hardwareConcurrency:16}).max,15);assert.equal(computePolicy({hardwareConcurrency:16,deviceMemory:8,mobile:true}).max,6);assert.equal(computePolicy({hardwareConcurrency:16,deviceMemory:8}).max,6);assert.equal(computePolicy({hardwareConcurrency:2,deviceMemory:8}).max,1);
const index=JSON.parse(fs.readFileSync('web/data/mining-anatomy.json'));validateAnatomyIndex(index,cfg);assert.throws(()=>validateAnatomyIndex({...index,registryRoot:'bad'},cfg));assert.throws(()=>validateAnatomyIndex({...index,cells:[index.cells[0],index.cells[0]]},cfg));
let callbacks=[];const r=new ReplayController({request:fn=>{callbacks.push(fn);return callbacks.length;},cancel:()=>{},reducedMotion:()=>false});r.load({steps:256,live:true,available:5});r.play();r.tick(0);r.tick(500);assert.equal(r.time,1);r.setAvailable(100);assert.equal(r.time,1,'append does not seek latest');r.tick(100000);assert.equal(r.time,1,'large animation gaps never jump to the newest data');r.seek(99);r.tick(100250);r.tick(100500);assert.equal(r.time,99);assert(r.waiting&&r.playing);r.setAvailable(150);assert(!r.waiting);assert.equal(r.time,99);r.pause();r.setAvailable(256);assert(!r.playing);assert.equal(r.time,99);
let locks=0,quota=10e9;
Object.defineProperty(globalThis,'navigator',{value:{storage:{estimate:async()=>({quota,usage:0})},locks:{request:async(_,opts,fn)=>{locks++;return fn({});}},hardwareConcurrency:8,deviceMemory:8},configurable:true});globalThis.document={hidden:false};globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
class Runtime{
 constructor(id='compute-primary'){this.workerId=id;this.ready=true;this.controlEvents=[];this.seq=0;}
 request(type,data){if(type==='restore'){this.ready=true;return Promise.resolve({});}if(type==='release-output')return Promise.resolve({});if(type!=='run')throw Error(type);
   this.data=data;return new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});}
 message(telemetry={}){return {networkId:this.data.networkId||'local-tools',roundId:this.data.task.roundId||'',sequence:++this.seq,producedAt:performance.now(),workerId:this.workerId,taskId:this.data.task.taskId,sessionId:this.data.sessionId,executionId:this.data.executionId,operationId:this.data.operationId,completedSteps:1,neuronUpdates:330244,synapseTransmissions:0,totalSteps:256,stage:'simulation',...telemetry};}
 progress(n=1){this.onCompute(this.message({completedSteps:n,neuronUpdates:330244*n}));}
 control(action){this.controlEvents.push(action);if(action==='pause')queueMicrotask(()=>this.onControl({...this.message(),state:'paused',telemetry:this.message({stage:'paused'})}));if(action==='resume')queueMicrotask(()=>this.onControl({...this.message(),state:'running'}));if(action==='cancel')this.reject(Object.assign(new Error('cancelled'),{code:'paused',computation:this.message(this.cancelCounts||{})}));}
 complete(){this.resolve({...this.message(),task:this.data.task,config:cfg,responseBytes:480,record:{},resultHash:this.data.task.taskId,computation:this.message({stage:'results',completedSteps:256}),traceBytes:new ArrayBuffer(0)});}
 release(){this.ready=false;}
}
const until=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,1));}throw Error('Timeout');};
function setup(count,{threads=4,saveError=false,quotaBytes=10e9,storageBytes=1024*1024*1024,activity=async()=>null}={}){
 quota=quotaBytes;const primary=new Runtime(),pool=new ComputePool(primary,{policy:{...computePolicy({hardwareConcurrency:8,deviceMemory:8}),max:4},createRuntime:id=>new Runtime(id)});pool.requested=threads;const local=[],saved=[],state=createMinerState(),runner=new TaskRunner({runtime:primary,pool,state,catalog,config:cfg,records:()=>local,save:async r=>{if(saveError)throw Error('disk quota');saved.push(r.task.taskId);local.push({global_task_index:r.task.k});},onResult:async()=>{},events:{emit(){}},activity});const completion=runner.start({count,minutes:10,storageBytes});return {runner,pool,primary,saved,state,completion};
}
{
 const x=setup(1);await until(()=>x.runner.active.length===1);assert.equal(x.pool.slots.size,1);x.primary.complete();await x.completion;assert.equal(x.saved.length,1);assert.equal(x.runner.reservedBytes,0);
}
{
 const x=setup(4);await until(()=>x.runner.active.length===4);assert.equal(new Set(x.runner.active.map(e=>e.task.taskId)).size,4);const plan=x.runner.plan;for(const e of x.runner.active)e.slot.runtime.progress(10);
 x.runner.setThreads(1);await until(()=>x.pool.snapshot().parked===3);assert.equal(x.pool.snapshot().busy,1);assert(plan.activeSince!==null,'shrinking does not freeze the whole clock');
 const parked=x.runner.active.filter(e=>e.slot.status==='parked').map(e=>e.id);x.runner.setThreads(2);await until(()=>x.pool.snapshot().busy===2);assert(x.runner.active.some(e=>parked.includes(e.id)&&e.slot.status==='running'));
 x.runner.pauseNow();await until(()=>x.runner.paused);assert.equal(plan.activeSince,null);assert.equal(x.runner.aggregate,null);
 x.runner.resume(new (await import('../web/session-plan.mjs')).SessionPlan({config:cfg}));await until(()=>x.pool.snapshot().busy===2);assert.equal(x.runner.active.length,4);
 let original=x.runner.active[0];original.slot.runtime.onCompute({...original.slot.runtime.message(),executionId:'old',neuronUpdates:999});assert.notEqual(original.telemetry.neuronUpdates,999,'stale execution is rejected');
 while(x.runner.running){for(const e of x.runner.active.filter(e=>e.slot.status==='running'))e.slot.runtime.complete();await new Promise(resolve=>setTimeout(resolve,5));}
 await x.completion;assert.equal(x.saved.length,4);assert.equal(new Set(x.saved).size,4);assert.equal(x.runner.reservedBytes,0);
}
{
 const x=setup(4,{storageBytes:100});await x.completion;assert.equal(x.saved.length,0);assert.equal(x.runner.active.length,0);
 const y=setup(4,{quotaBytes:100});await y.completion;assert.equal(y.saved.length,0);assert.equal(y.runner.reservedBytes,0);
 const z=setup(2,{saveError:true});await until(()=>z.runner.active.length===2);for(const e of z.runner.active)e.slot.runtime.complete();await z.completion;assert.equal(z.saved.length,0);assert.equal(z.runner.plan.completed,2);
}
{
 const x=setup(4,{activity:async()=>({snapshot:{state:{state:1},clock:{unixTimestamp:0},pages:[]},rules:{submit_deadline:100},pending:0,maxPending:1})});await x.completion;assert.equal(x.runner.active.length,0,'invalid pending/chain activity has no dispatch');
}
{
 const x=setup(4);await until(()=>x.runner.active.length===4);x.runner.setThreads(1);await until(()=>x.pool.snapshot().parked===3);x.runner.pauseAfter();await new Promise(r=>setTimeout(r,5));assert.equal(x.pool.snapshot().busy,1,'finish-current drains parked tasks at the requested concurrency');
 while(x.runner.running){assert(x.pool.snapshot().busy<=1);for(const e of x.runner.active.filter(e=>e.slot.status==='running'))e.slot.runtime.complete();await new Promise(r=>setTimeout(r,5));}await x.completion;assert.equal(x.saved.length,4);
}
{
 const x=setup(2,{threads:2});await until(()=>x.runner.active.length===2);let now=0;x.runner.clock=()=>now;x.runner.resetSample();const executions=x.runner.active;executions[0].slot.runtime.progress(1);executions[1].slot.runtime.progress(2);now=1000;x.runner.sample();assert.equal(x.runner.aggregate.neuronUpdatesPerSecond,null);now=5000;x.runner.sample();assert.equal(x.runner.aggregate.neuronUpdatesPerSecond,330244*3/5,'aggregate uses cumulative deltas divided by one common second');x.runner.pauseNow();await until(()=>x.runner.paused);assert.equal(x.runner.aggregate,null);x.runner.stopNow();await x.completion;
}
{
 const snapshot={state:{state:1},clock:{unixTimestamp:0},pages:Array.from({length:832},(_,k)=>({k,complete:false,queue:[{submission:new Array(32).fill(0)}]}))};
 const x=setup(4,{activity:async()=>({snapshot,rules:{submit_deadline:100},pending:0,maxPending:1})});await until(()=>x.runner.active.length===1);await new Promise(r=>setTimeout(r,5));assert.equal(x.runner.active.length,1,'one pending allowance reserves only one task');x.primary.complete();await x.completion;assert.equal(x.saved.length,1);
 const y=setup(4,{activity:async()=>({snapshot,rules:{submit_deadline:100},pending:0,maxPending:8,quote:{max:100n},spent:0n,feeLimit:150n})});await until(()=>y.runner.active.length===1);await new Promise(r=>setTimeout(r,5));assert.equal(y.runner.active.length,1,'pending funding reservations prevent overspending the session');y.primary.complete();await y.completion;
}
{
 const x=setup(2,{threads:2});await until(()=>x.runner.active.length===2);const bad=x.runner.active[0],healthy=x.runner.active[1];bad.slot.runtime.reject(new Error('Injected one-Worker failure'));await until(()=>bad.done);assert(!healthy.done);healthy.slot.runtime.complete();await x.completion;assert.equal(x.saved.length,1,'a separate healthy worker still saves its exact output');
 // The user re-prepares a failed primary without a full page refresh.
 x.primary.ready=true;const done=x.runner.start({count:1});await until(()=>x.runner.active.length===1);x.runner.active[0].slot.runtime.complete();await done;assert.equal(x.saved.length,2);
}
{
 const primary=new Runtime();let rejectOld,attempts=0;
 const pool=new ComputePool(primary,{policy:{max:4,defaultThreads:2},createRuntime:id=>{const r=new Runtime(id);r.ready=false;r.request=async()=>{attempts++;if(attempts===1)await new Promise((_,reject)=>rejectOld=reject);r.ready=true;};return r;}});
 const warming=pool.warmOne(cfg,'fault-session');await until(()=>rejectOld);
 pool.setRequested(1);pool.setRequested(2);rejectOld(new Error('Injected stale warmup failure'));await warming;
 assert.equal(pool.failedExpansion,false,'failure from a superseded request cannot lock the new expansion');
 assert.equal(pool.snapshot().warming,0);assert.equal(pool.slots.size,1);
 await pool.warmOne(cfg,'fault-session');assert.equal(pool.snapshot().prepared,2,'latest request can warm a healthy independent slot');
 const secondary=[...pool.slots.values()].find(s=>s.runtime!==primary);secondary.runtime.ready=false;pool.prune();assert.equal(pool.slots.size,1,'dead ready=false instances cannot occupy reusable slots');
 pool.failedExpansion=true;assert(pool.retryExpansion());assert(pool.retryExpansion());assert(pool.retryExpansion());assert.equal(pool.retryExpansion(),false,'retry is bounded over one minute');pool.dispose();
}
{
 const x=setup(2,{threads:2});await until(()=>x.runner.active.length===2);const [a,b]=x.runner.active;
 a.slot.runtime.onCompute(a.slot.runtime.message({workNeuronUpdates:'9',workSynapseAdditions:'1'}));a.slot.runtime.cancelCounts={workNeuronUpdates:'13',workSynapseAdditions:'3'};b.slot.runtime.cancelCounts={workNeuronUpdates:'17',workSynapseAdditions:'2'};
 x.runner.stopNow();await x.completion;assert.equal(x.runner.totals().neurons,'30');assert.equal(x.runner.totals().synapses,'5');assert.equal(x.runner.meter.inflight.size,0);assert.equal(x.saved.length,0);
 x.runner.fail(a,Object.assign(new Error('Late failed message'),{code:'paused',computation:a.slot.runtime.message({workNeuronUpdates:'1000'})}));assert.equal(x.runner.totals().neurons,'30','late cancelled advanced task cannot double count or resurrect');
}
assert(locks>=5);console.log('Coordinator count/space reservations, requested-vs-parked controls, shared clock, stale identities, saves, eligibility, superseded expansion failures, dead-slot pruning and bounded retry passed (faults simulated).');
