// Storage/UI fault fixtures. Silent synthetic archives are never submitted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Directory } from './opfs_fixture.mjs';
import { CandidateStoreV2 } from '../web/candidate-store-v2.mjs';
import { GoalMiningView } from '../web/goal-mining-view.mjs';
import { deriveGoalUiState } from '../web/goal-ui-state.mjs';
import { miningWorkflow } from '../web/mining-workflow.mjs';
import { retainOutput,retainedOutputs } from '../web/pending-output.mjs';
import { buildRecord } from '../web/response-record.mjs';
import { targetRecord } from '../web/target-response-record.mjs';
import { trialTask,inputs,candidateId,evaluate } from '../web/target-protocol-v2.mjs';
const v=JSON.parse(readFileSync('tests/vectors/target-v2.json')),cfg=JSON.parse(readFileSync('web/data/research-profiles/duration256-v1-dev/config.json'));
globalThis.window={FlyI18n:{language:'en'}};
const base={network:{enabled:true},online:true,snapshot:{state:'RUNNING',round:{pre:{claimDeadline:200}}},serverNow:100,preparation:'ready',pendingOutputs:1};
for(const patch of [{},{online:false},{network:{enabled:false}},{serverNow:300},{snapshot:{state:'RESEARCH_STAGE_COMPLETE',round:null}},{preparation:'unsupported'},{running:true,paused:true}]){
 const ui=deriveGoalUiState({...base,...patch});assert.equal(ui.action,'retry-save');assert.equal(ui.disabled,false);
}
assert.equal(deriveGoalUiState({...base,actionBusy:true}).disabled,true);
assert.equal(deriveGoalUiState({...base,running:true}).action,'pause');
assert.equal(miningWorkflow({phase:'needed'},{pendingOutputs:1}).step,'mining');
let blocked=false,lease=true;const disk=new Directory('',path=>blocked&&path.includes('flypow-candidates-')&&path.endsWith('/state.json'));
Object.defineProperty(globalThis,'navigator',{value:{storage:{getDirectory:async()=>disk},locks:{request:async(_,opts,fn)=>fn(lease?{}:null)}},configurable:true});
const network={enabled:false,networkId:v.round.pre.networkId,authorityId:v.round.pre.authorityId};const store=new CandidateStoreV2(network);store.config=cfg;
const queued=[],runner={running:false,paused:false,pendingResults:new Map(),recoverCandidate:m=>{assert.equal(runner.running,false,'local recovery cannot start CPU');queued.push(m);},budget:{stagingBytes:0,savedBytes:0,remember(){}}};
const view=Object.assign(Object.create(GoalMiningView.prototype),{store,network,runner,runtime:{ready:false},client:{online:false,identity:null,serverNow:1},state:{value:{preparation:{phase:'needed'}}},rows:[],pending:[],recoveryErrors:new Map(),onChange(){},render(){},renderResults(){}});
async function output(index){
 const input=inputs(v.goal)[index],task=await trialTask(v.round,input,0),meta=await store.begin(v.round,input,await candidateId(v.round.roundId,input));
 const bytes=new Uint8Array(480),header=new DataView(bytes.buffer);bytes.set(new TextEncoder().encode('FBRP1\0\0\0'));for(const [at,n]of [[8,cfg.neuron_count],[12,task.targetIndex],[16,256]])header.setUint32(at,n,true);
 const bundle=await targetRecord(await buildRecord(bytes,cfg,task,b=>v.goal.stimulusSet.find(x=>x.bodyId===b.toString()).modelIndex),task,v.round);
 const r={...bundle,task,config:cfg,archive:new Blob([bytes]),responseBytes:bytes.length,resultHash:bundle.resultRoot,goalMetrics:await evaluate(v.goal,input,bytes),temporary:crypto.randomUUID()+'.bin',executionId:crypto.randomUUID()};
 const staging=await disk.getDirectoryHandle('flypow-result-staging-v1',{create:true}),h=await staging.getFileHandle(r.temporary,{create:true}),w=await h.createWritable();await w.write(bytes);await w.close();await retainOutput(r,{round:v.round,executionId:r.executionId});return {r,meta};
}
const {r,meta}=await output(0);runner.pendingResults.set(r.executionId,r);runner.budget.stagingBytes=r.responseBytes+65536;await view.refresh();assert.equal(view.ui().disabled,false);
blocked=true;await assert.rejects(view.retryPendingOutputs(),{name:'QuotaExceededError'});
assert.equal(view.ui().action,'retry-save');assert.equal(view.ui().disabled,false);assert.equal(view.pending.length,1);assert.equal(view.recoveryErrors.get(r.task.trialId).name,'QuotaExceededError');
assert.equal((await retainedOutputs())[0].saveError.name,'QuotaExceededError','real save error survives a new metadata read');assert.equal((await store.metadata(meta.candidateId)).trials.length,0);assert.equal(queued.length,0);
lease=false;await assert.rejects(view.retryPendingOutputs(),/Another page/);assert.equal((await retainedOutputs()).length,1);lease=true;
blocked=false;await view.retryPendingOutputs();assert.equal(view.pending.length,0);assert.equal(runner.pendingResults.size,0);assert.equal(runner.budget.stagingBytes,0);assert.equal(runner.budget.savedBytes,r.responseBytes+65536);assert.equal(queued.length,1);assert.equal((await store.bundle(await store.metadata(meta.candidateId),0)).resultHash,r.resultHash);
// A committed result with leftover staging must not reset winner history or
// charge the same bytes twice when cleaning up after an interrupted save.
const winner=await store.metadata(meta.candidateId);winner.won=true;winner.phase='winner-confirmed';winner.terminalCompetition=true;await store.update(winner);
const staging=await disk.getDirectoryHandle('flypow-result-staging-v1'),h=await staging.getFileHandle(r.temporary,{create:true}),w=await h.createWritable();await w.write(r.archive);await w.close();await retainOutput(r,{round:v.round,executionId:r.executionId});await view.refresh();await view.retryPendingOutputs();assert.equal((await store.metadata(meta.candidateId)).phase,'winner-confirmed');assert.equal(runner.budget.savedBytes,r.responseBytes+65536);
const bad=await output(1);await view.refresh();view.pending[0].archive=new Blob([new Uint8Array(480).fill(1)]);await assert.rejects(view.retryPendingOutputs(),/hash mismatch/);assert.equal((await retainedOutputs()).length,1);assert.equal((await store.metadata(bad.meta.candidateId)).trials.length,0);
console.log(JSON.stringify({passed:6,scope:'Synthetic silent OPFS fault fixtures; no scientific computation or network submission',checks:['Local retry precedes offline, expired, unconfigured and unsupported states','Completed output remains in stage three without model loading','Quota and concurrent-tab errors retain artifacts and remain retryable','Retry commits and reads original bytes before staging cleanup; no CPU or network','Committed winner and accounting survive leftover cleanup','Corrupt retained bytes reject without deleting staging']}));
