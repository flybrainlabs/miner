// Real OPFS interface fixture, explicit synthetic scientific bytes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Directory} from './opfs_fixture.mjs';
import {CandidateStoreV2} from '../web/candidate-store-v2.mjs';
import {buildRecord} from '../web/response-record.mjs';
import {factoryRecord,validateFactoryRecord} from '../web/task-factory-result-v4.mjs';
import {descriptorFor,makeRound,factoryTrialTask} from '../web/task-factory-v4-science.mjs';
import {candidateId,evaluate} from '../web/target-protocol-v2.mjs';
const vector=JSON.parse(await readFile('tests/vectors/target-v2.json')),config=JSON.parse(await readFile('web/data/research-profiles/duration256-v1-dev/config.json')),spec={schema:'flybrainlabs-scientific-task-v4',goal:vector.goal,seeds:['0000000000000001','0000000000000002']};
const descriptor=await descriptorFor(spec,{rewardAtoms:'100',claimSeconds:10,revealSeconds:20,verifySeconds:30,maxAttempts:2}),round=await makeRound({program:'fixture-program',genesis:'fixture-network',factoryAddress:'fixture-factory',taskAddress:'fixture-task',factory:{},task:{index:0,attempt:0,descriptor,openedAt:1n,claimDeadline:11n,revealDeadline:21n,verifyDeadline:31n},spec});
let failState=false,failHead=false;const disk=new Directory('',path=>failState&&path.endsWith('/state.json')||failHead&&path.endsWith('/index-v1/head.json'));Object.defineProperty(globalThis,'navigator',{value:{storage:{getDirectory:async()=>disk}},configurable:true});
const network={protocolVersion:4,networkId:'fixture-network',campaignId:'fixture-factory'},store=new CandidateStoreV2(network);store.config=config;
const task=await factoryTrialTask(round,vector.input,0),meta=await store.begin(round,vector.input,await candidateId(round.roundId,vector.input)),bytes=new Uint8Array(480),view=new DataView(bytes.buffer);
bytes.set(new TextEncoder().encode('FBRP1\0\0\0'));for(const [at,n]of [[8,config.neuron_count],[12,task.targetIndex],[16,256]])view.setUint32(at,n,true);
const bundle=await factoryRecord(await buildRecord(bytes,config,task,b=>vector.goal.stimulusSet.find(x=>x.bodyId===String(b)).modelIndex),task,round),result={...bundle,task,config,archive:new Blob([bytes]),responseBytes:480,resultHash:bundle.resultRoot,goalMetrics:await evaluate(vector.goal,vector.input,bytes)};
await store.saveTrial(meta,result);const restored=new CandidateStoreV2(network);restored.config=config;
const loaded=await restored.bundle(await restored.metadata(meta.candidateId));assert.equal(loaded.task.protocolVersion,4);assert.equal(loaded.record.schema,'flybrainlabs-target-response-record-v4');assert.deepEqual(new Uint8Array(await loaded.archive.arrayBuffer()),bytes);
assert.throws(()=>validateFactoryRecord({...loaded.record,protocolVersion:2},meta,meta.trials[0],task));
assert.equal((await new CandidateStoreV2({networkId:'fixture-network',authorityId:'fixture-factory'}).list()).length,0);
assert.equal((await new CandidateStoreV2({...network,campaignId:'other-factory'}).list()).length,0);assert.equal((await restored.list()).length,1);
const exported=await restored.exportFiles(meta);assert.equal(JSON.parse(await exported[0].data.text()).schema,'flybrainlabs-candidate-export-v4');
console.log(JSON.stringify({passed:true,checks:['V4 complete archive survives store recreation','V4 records and export keep explicit schemas','V2 and other factory OPFS data remain isolated'],scientificFixtures:true}));

// Crash after complete trial side files but before state commit: a fresh store
// validates actual bytes and recomputes science instead of inventing an output.
const task2=await factoryTrialTask(round,vector.input,1),bundle2=await factoryRecord(await buildRecord(bytes,config,task2,b=>vector.goal.stimulusSet.find(x=>x.bodyId===String(b)).modelIndex),task2,round),result2={...bundle2,task:task2,config,archive:new Blob([bytes]),responseBytes:480,resultHash:bundle2.resultRoot,goalMetrics:await evaluate(vector.goal,vector.input,bytes)};
meta.partial=true;await store.update(meta);failState=true;await assert.rejects(store.saveTrial(meta,result2),{name:'QuotaExceededError'});assert.equal(meta.trials.length,1);failState=false;
const crashed=new CandidateStoreV2(network);crashed.config=config;const recovered=(await crashed.list())[0];assert.equal(recovered.trials.length,2);assert.equal(recovered.partial,false);await crashed.bundle(recovered,1);
// Multiple completed side-file receipts are recovered in background order,
// independent of the directory iterator's order.
const emptyPrefix={...recovered,trials:[],partial:true,sciencePassed:false};await crashed.update(emptyPrefix);const candidateDir=await crashed.candidate(meta.candidateId);candidateDir.entries=async function*(){yield* [...this.items.entries()].reverse();};const reordered=new CandidateStoreV2(network);reordered.config=config;const ordered=(await reordered.list())[0];assert.deepEqual(ordered.trials.map(t=>t.repeatIndex),[0,1]);assert.equal(ordered.partial,false);
// State can also commit while the derived index fails. A write-ahead marker
// repairs that index, without removing the authoritative result or original ID.
recovered.rewardPaid=true;failHead=true;await assert.rejects(crashed.update(recovered));failHead=false;
const repaired=new CandidateStoreV2(network);repaired.config=config;assert.equal((await repaired.list())[0].rewardPaid,true);
for(let i=0;i<140;i++)await repaired.update({...recovered,candidateId:(i+1).toString(16).padStart(64,'0'),createdAt:i,savedAt:i,partial:false,sciencePassed:false});
assert.equal((await repaired.list({limit:20,includeActive:false})).length,20);assert.equal((await repaired.usage()).total,141);assert.equal((await repaired.list({limit:20,offset:20,includeActive:false})).length,20);
console.log(JSON.stringify({passed:true,crashAfterTrial:true,crashAfterState:true,historicalCandidates:141,pageSize:20,scientificFixtures:true}));
// A UI retry after switching catalogs must use the captured original store.
const {GoalMiningView}=await import('../web/goal-mining-view.mjs');
let wrongStoreReads=0;const retryView=Object.create(GoalMiningView.prototype);retryView.store={metadata(){wrongStoreReads++;throw new Error('Wrong catalog');}};
const pending={...result2,executionContext:{store:crashed,network},temporary:null};retryView.runner={pendingResults:new Map([['old-execution',pending]]),budget:{stagingBytes:100000,savedBytes:0,remember(){}},recoverCandidate(){throw new Error('Old candidate must not enter the new catalog scheduler');}};
await retryView.recoverOutput(pending);assert.equal(wrongStoreReads,0);assert.equal(retryView.runner.pendingResults.size,0);assert.equal((await crashed.metadata(meta.candidateId)).trials.length,2);
console.log(JSON.stringify({passed:true,originalContextRecovery:true,wrongCatalogReads:wrongStoreReads}));
