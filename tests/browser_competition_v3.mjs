// Uses real browser-produced claims/archives. Controls replay ordering only.
// Local keys are protocol tests, not independent verifier operators.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {keyFile,request,verified,api} from '../tools/target_dev_identity.mjs';
import {verifyJob,getModelReadiness} from '../tools/candidate_verifier_v2.mjs';
const dir=resolve('/workspace/.flypow-tools/live-current-v3-network'),base='http://127.0.0.1:8790',network=JSON.parse(await readFile(join(dir,'network-public.json'))),authorityId=network.authorityId,output=resolve(process.argv[2]||'data/prepared/live-current-v3/competition');await mkdir(output,{recursive:true});
const report={schema:'flypow-v3-real-browser-competition',scope:'loopback preview only; controlled known test input; no new discoveries',physicalAndroid:false,independentVerifierOperators:false,officialDownloads:0,checks:[],replays:[]};
const save=()=>writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n'),check=async s=>{report.checks.push(s);await save();console.log(JSON.stringify({passed:report.checks.length,check:s}));};
const a=JSON.parse(await readFile('data/prepared/live-current-v3/browser-A/report.json')),b=JSON.parse(await readFile('data/prepared/live-current-v3/browser-B/report.json'));assert(a.passed&&b.passed&&!a.failure&&!b.failure);assert.equal(a.roundId,b.roundId);assert.equal(a.goalId,b.goalId);assert.notEqual(a.minerId,b.minerId);assert.equal(a.candidate.candidateId,b.candidate.candidateId);report.roundId=a.roundId;report.goalId=a.goalId;report.miners=[a.minerId,b.minerId];
const claim=async cid=>verified(authorityId,'claim-state',await(await api(base,'claims/'+cid)).json()),round=async rid=>verified(authorityId,'round-state',await(await api(base,'rounds/'+rid)).json());
const ac=await claim(a.claim.claimId),bc=await claim(b.claim.claimId);assert.equal(ac.status,'REVEALED');assert.equal(bc.status,'REVEALED');assert(ac.receipt.claimSequence<bc.receipt.claimSequence);report.receipts=[ac.receipt,bc.receipt];await check('Two retained browser identities compute, save, commit, upload and reveal full candidates for the same frozen goal/round');
const runtime=JSON.parse(await readFile(join(dir,'verifier-runtime.json'))),keys=await Promise.all([0,1].map(i=>keyFile(join(dir,'private/verifier-'+i+'.key'))));
const modelReadiness=await getModelReadiness(runtime.binary,runtime.modelDir);
const lease=async key=>(await verified(authorityId,'verification-lease',await(await api(base,'verifier-jobs/lease',await request(key,'verifier-lease','',{modelReadiness}))).json())).job;
const aj=[],bj=[];for(const key of keys){const j=await lease(key);assert.equal(j.claimId,a.claim.claimId);aj.push(j);}for(const key of keys){const j=await lease(key);assert.equal(j.claimId,b.claim.claimId);bj.push(j);}
let heartbeatError;const heartbeat=setInterval(()=>{for(const [i,j]of aj.entries())request(keys[i],'verifier-heartbeat',j.roundId,{jobId:j.jobId,fencingToken:j.fencingToken}).then(r=>api(base,'verifier-jobs/heartbeat',r)).catch(e=>heartbeatError=e);},20000);
// Keep earlier leases active, then deliberately finish later B first.
try{for(const [i,j]of bj.entries()){const v=await verifyJob({...runtime,base,authorityId,key:keys[i],job:j,log:x=>console.log(JSON.stringify(x))});assert(v.valid);report.replays.push({miner:'B',verifierId:keys[i].publicKey,trials:v.measurements});}assert.equal((await round(a.roundId)).winner,null);await check('Later B completes two full native replays first; earlier admitted A still blocks winner finalization');
 report.readyForRestart=true;await save();console.log(JSON.stringify({checkpoint:'restart-authority-preserving-WAL-then-create-marker',marker:join(output,'authority-restarted.json')}));
 for(let i=0;;i++){try{report.restart=JSON.parse(await readFile(join(output,'authority-restarted.json')));break;}catch(e){if(e.code!=='ENOENT')throw e;if(i>=120)throw new Error('Authority restart checkpoint timed out');await new Promise(r=>setTimeout(r,1000));}}
 if(heartbeatError)throw heartbeatError;assert.equal((await round(a.roundId)).winner,null);assert.equal((await claim(a.claim.claimId)).receipt.claimSequence,ac.receipt.claimSequence);await check('Actual authority restart reuses SQLite/WAL, admitted claim order and pending winner state');
 for(const [i,j]of aj.entries()){const v=await verifyJob({...runtime,base,authorityId,key:keys[i],job:j,log:x=>console.log(JSON.stringify(x))});assert(v.valid);report.replays.push({miner:'A',verifierId:keys[i].publicKey,trials:v.measurements});}
 const final=await round(a.roundId);assert.equal(final.winner.claimId,a.claim.claimId);report.winner=final.winner;await check('Earlier valid A wins exactly once after authorized full replay quorum; actual browser archives match native byte for byte');
 const next=await verified(authorityId,'authority-snapshot',await(await api(base,'rounds/current')).json());assert(next.round);assert.notEqual(next.round.pre.goalId,a.goalId);assert.equal(next.capabilities.controller.validSamples,1);report.nextRound=next.round;report.controller=next.capabilities.controller;await check('Authority advances to a distinct calibrated scientific goal and preserves the same comparable-family success sample');
 report.passed=report.checks.length;await save();
}finally{clearInterval(heartbeat);}
