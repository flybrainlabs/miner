// Worker dispatch/state fixtures; no simulated result is scientific evidence.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GoalSearchRunner} from '../web/goal-search-runner.mjs';
import {createMinerState} from '../web/miner-state.mjs';
import {deriveGoalUiState} from '../web/goal-ui-state.mjs';
const vector=JSON.parse(await readFile('tests/vectors/target-v2.json'));
globalThis.document={hidden:false};globalThis.localStorage={setItem(){},getItem(){return null;}};
Object.defineProperty(globalThis,'navigator',{value:{storage:{estimate:async()=>({quota:10*1024**3,usage:0})},locks:{request:async(_name,_opts,fn)=>fn({})}},configurable:true});
let clock=1,launches=0,funding=0,controls=[];
const client={network:{networkId:'isolated-continuity'},identity:{publicKey:'1'.repeat(64)},online:true,round:null,snapshot:{state:'RESEARCH_STAGE_COMPLETE',round:null},serverNow:1,sync:async()=>client.snapshot,reportWork:async()=>{},heartbeat:async()=>{}};
const financial={account:{address:'fixture-wallet'},login:{expiresAt:Math.floor(Date.now()/1000)+1000},generation:1,requireFunding:async()=>{funding++;return {wallet:financial.account.address,grant:'finite-fixture-grant',generation:'1'};},reportAttempt:async()=>{}};
const runtime={ready:true,workerId:'worker',control:action=>controls.push(action)},slot={id:'worker',runtime,status:'idle',execution:null};
const pool={slots:new Map([['worker',slot]]),requested:1,resetExpansion(){},trim(){},prune(){},snapshot:()=>({requested:1}),warmOne:async()=>false};
const rows=new Map(),store={cursor:async()=>({schema:'none',cursor:0}),list:async()=>[...rows.values()],saveCursor:async()=>{},begin:async(round,input,id)=>{const m={candidateId:id,roundId:round.roundId,round,input,trials:[],partial:true};rows.set(id,m);return m;},update:async m=>rows.set(m.candidateId,m)};
const runner=new GoalSearchRunner({runtime,pool,config:{},client,financial,store,state:createMinerState(),submission:{}});
runner.runCandidate=async e=>{launches++;e.telemetry={stage:'simulation'};};
const flush=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setTimeout(resolve,5));};
try{
 await runner.start({storageBytes:2*1024**3});await flush();assert(runner.running&&runner.intent);assert.equal(runner.phase,'waiting-next-goal');assert.equal(launches,0);assert.equal(funding,0);assert.equal(runner.budget.elapsedMs,0);
 const ui=deriveGoalUiState({network:{enabled:true},online:true,snapshot:client.snapshot,preparation:'ready',walletRequired:true,walletConnected:true,walletSignedIn:true});assert.equal(ui.action,'start');assert.equal(ui.button,'wait-for-tasks');
 client.online=false;runner.disconnected(new Error('fixture disconnect'));assert(runner.paused&&runner.intent&&runner.reconnecting);client.online=true;runner.syncRound(client.snapshot);await flush();assert(!runner.paused&&runner.intent);assert.equal(launches,0);
 client.round=structuredClone(vector.round);client.round.pre.claimDeadline=1000;client.snapshot={state:'RUNNING',round:client.round};runner.syncRound(client.snapshot);await flush();assert.equal(launches,1);assert.equal(funding,1);assert.equal(runner.active[0].round.roundId,vector.round.roundId);
 const active=runner.active[0];runner.roundEvent({kind:'ROUND_FINALIZED',roundId:vector.round.roundId});assert(active.cancelled);assert(controls.includes('cancel'));active.telemetry=null;runner.complete(active);client.round=null;client.snapshot={state:'RESEARCH_STAGE_COMPLETE',round:null};runner.syncRound(client.snapshot);await flush();assert(runner.running&&runner.intent);assert.equal(runner.phase,'waiting-next-goal');
 client.online=false;runner.disconnected();runner.pauseNow();assert(!runner.intent&&!runner.reconnecting);client.online=true;runner.syncRound(client.snapshot);await flush();assert(runner.paused&&!runner.intent);assert.equal(launches,1);
 runner.stopNow();await runner.completion;assert(!runner.running);assert.equal(runner.budget.savedBytes,0);
 await runner.start({storageBytes:2*1024**3});await flush();financial.generation++;runner.syncRound(client.snapshot);await flush();assert.equal(runner.pauseReason,'wallet-changed');assert(!runner.intent);runner.stopNow();await runner.completion;
 await runner.start({storageBytes:2*1024**3});await flush();financial.login.expiresAt=1;client.round=structuredClone(vector.round);client.round.roundId='2'.repeat(64);client.round.pre.claimDeadline=1000;client.snapshot={state:'RUNNING',round:client.round};runner.syncRound(client.snapshot);await flush();assert.equal(runner.pauseReason,'wallet-login-required');assert.equal(launches,1);runner.stopNow();await runner.completion;
 console.log(JSON.stringify({passed:true,checks:22,scope:'isolated continuity, dispatch and authorization boundaries',chainWrites:0,fullModelComputations:0}));
}finally{runner.dispose();}
