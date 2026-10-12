import assert from 'node:assert/strict';
import { WorkMeter } from '../web/work-meter.mjs';
import { ComputationMeter } from '../web/computation.mjs';
import { GoalBudget } from '../web/goal-search-runner.mjs';
import { computePolicy, ComputePool } from '../web/compute-pool.mjs';
import { validateDeployment, assertServiceIdentity } from '../web/mining-deployment.mjs';
import fs from 'node:fs';
let at=0;const meter=new WorkMeter({clock:()=>at});meter.setStatus('running');
const scope=id=>({networkId:'net',sessionId:'session',roundId:'round',workerId:id,executionId:id,operationId:id});
const packet=(id,sequence,n,s=0)=>({...scope(id),sequence,producedAt:at,workNeuronUpdates:String(n),workSynapseAdditions:String(s),stage:'simulation'});
meter.register(scope('a'));meter.register(scope('b'));
assert(meter.merge(packet('a',1,100,10)));assert(meter.merge(packet('b',1,200,20)));at=1000;meter.sample();assert.equal(meter.snapshot().neuronUpdatesPerSecond,null,'short first samples are not stable rates');
assert(!meter.merge(packet('a',1,100,10)));assert(!meter.merge({...packet('a',2,500),roundId:'old'}));assert(!meter.merge(packet('a',2,99)));
for(let i=2;i<=40;i++){at=i*1000;meter.merge(packet('a',i,100*i,10*i));meter.merge(packet('b',i,200*i,20*i));meter.sample();}
assert.equal(meter.snapshot().neuronUpdatesPerSecond,300);assert.equal(meter.snapshot().recentNeuronUpdatesPerSecond,300);assert(meter.samples.length<=32);
// Final counters complete the missing progress once; duplicates cannot resurrect.
at=41000;meter.retire('a',packet('a',41,4200,420));const total=meter.total.neurons;meter.retire('a',packet('a',42,9000));assert.equal(meter.total.neurons,total);assert.equal(meter.inflight.size,1);
meter.setStatus('paused');at=51000;meter.sample();assert.equal(meter.snapshot().neuronUpdatesPerSecond,null);meter.setStatus('running');assert.equal(meter.snapshot().sampledMs,0);
at=56000;meter.sample();assert.equal(meter.snapshot().neuronUpdatesPerSecond,0,'no fake running peak without work');
const isolated=new WorkMeter();isolated.register(scope('first'));isolated.register(scope('second'));isolated.retire('first',packet('second',1,999));assert.equal(isolated.total.neurons,0n,'a mismatched final cannot contaminate another in-flight execution');assert.equal(isolated.inflight.size,1);
// Time clipping is interpolation between cumulative anchors, not sample-count averaging.
const clipped=new WorkMeter({clock:()=>at,minimumSampleMs:0});clipped.setStatus('running');clipped.register(scope('x'));for(let i=0;i<8;i++){at+=7000;clipped.merge(packet('x',i+1,(i+1)*7000));clipped.sample();}assert.equal(clipped.snapshot().neuronUpdatesPerSecond,1000);
const core=new ComputationMeter({taskId:'task',bodyId:'1'},{steps:2,neuron_count:4,time_step_us:1000},()=>at,scope('core'));core.step(0,2,0,0,0,0);core.partial(6,3);const partial=core.snapshot('simulation');core.step(1,2,8,5,0,0);const boundary=core.snapshot('simulation');assert.equal(Number(boundary.workNeuronUpdates)-Number(partial.workNeuronUpdates),2);assert.equal(boundary.completedSteps,1);assert.equal(partial.completedSteps,0);
// Thousands of retired executions leave no history Map to scan or grow.
meter.retire('b');for(let i=0;i<10000;i++){const id='trial'+i;meter.register(scope(id));meter.retire(id,packet(id,1,330244,400));}assert.equal(meter.inflight.size,0);assert(meter.samples.length<=32);assert.equal(typeof meter.snapshot().totalNeuronUpdates,'string');
assert.equal(new GoalBudget().minutes,null);assert.equal(new GoalBudget().limit,null);assert.throws(()=>new GoalBudget({minutes:0}));
assert(computePolicy({hardwareConcurrency:16,mobile:true}).max>2);assert.equal(computePolicy({hardwareConcurrency:16,mobile:true}).defaultThreads,1);assert(computePolicy({hardwareConcurrency:16}).max>2);assert.equal(computePolicy({hardwareConcurrency:16,deviceMemory:1}).max,1);
const primary={workerId:'primary',ready:true,wasmModule:'code',release(){this.ready=false;}};let fail=true;const pool=new ComputePool(primary,{policy:computePolicy({hardwareConcurrency:8}),createRuntime:id=>({workerId:id,ready:false,async request(){if(fail)throw Error('allocation rejected');this.ready=true;},release(){this.ready=false;}})});pool.setRequested(4);assert.equal(await pool.warmOne({},'s'),null);assert(pool.snapshot().expansionFailed);fail=false;assert(pool.retryExpansion());assert(await pool.warmOne({},'s'));assert.equal(pool.snapshot().prepared,2);pool.slots.set('dead',{id:'dead',runtime:{ready:false,release(){}},status:'failed'});pool.prune();assert(!pool.slots.has('dead'));pool.slots.get('primary').status='resuming';assert.equal(pool.snapshot().busy,1);
const deployment=JSON.parse(fs.readFileSync('web/data/mining-deployment-v1.json')),config=JSON.parse(fs.readFileSync('web/data/research-config.json'));validateDeployment(deployment,config);assert.throws(()=>validateDeployment({...deployment,model:{...deployment.model,graphRoot:'bad'}},config));const d=validateDeployment(deployment,config);assertServiceIdentity(d,{...d,environment:d.environment,modelIdentity:d.model,serviceCapabilities:d.capabilities});assert.throws(()=>assertServiceIdentity(d,{...d,campaignId:'wrong',modelIdentity:d.model,serviceCapabilities:d.capabilities}));
console.log('15 product work-meter/pool/identity groups passed; 10,000 retired executions bounded. Controlled clocks/counters and simulated allocation failures.');
