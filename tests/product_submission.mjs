import fs from 'node:fs';
import assert from 'node:assert/strict';
import {CandidateSubmissionV2} from '../web/candidate-submission-v2.mjs';
for(const status of ['VALID','INVALID','TIMED_OUT','REVEALED','COMMITTED']){
 const m={claimId:'mine',roundId:'round',phase:'verifying'};const saved=[];
 const client={claimState:async()=>({status,receipt:{},validVotes:status==='VALID'?2:0,invalidVotes:status==='INVALID'?2:0,quorum:2,verificationQueue:{pending:1},terminalReason:status==='INVALID'?'full-replay-differs':status==='TIMED_OUT'?'deadline-passed':null}),roundState:async()=>({status:'FINALIZED',winner:{claimId:'other'}})};
 const submission=new CandidateSubmissionV2(client,{update:async r=>saved.push(structuredClone(r))});await submission.reconcile(m);assert.equal(m.phase,status==='VALID'?'saved-not-selected':status.toLowerCase());assert.equal(m.won,false);assert.equal(m.independentlyReplayed,status==='VALID');assert.equal(m.validVotes,status==='VALID'?2:0);assert.equal(m.invalidVotes,status==='INVALID'?2:0);assert.equal(saved.length,1);
 if(status==='INVALID')assert.equal(m.terminalReason,'full-replay-differs');if(status==='TIMED_OUT')assert.equal(m.terminalReason,'deadline-passed');
}
{
 // Actual deployment exposed a final vote arriving between two signed reads.
 // Reading the round first keeps the following vote state at least as fresh.
 let finalized=false;const m={claimId:'mine',roundId:'round',phase:'verifying'};
 const client={roundState:async()=>{finalized=true;return {status:'FINALIZED',winner:{claimId:'mine'}};},claimState:async()=>({status:finalized?'VALID':'REVEALED',receipt:{},validVotes:finalized?2:1,invalidVotes:0,quorum:2})};
 await new CandidateSubmissionV2(client,{update:async()=>{}}).reconcile(m);
 assert.equal(m.phase,'winner-confirmed');assert.equal(m.won,true);assert.equal(m.validVotes,2);assert.equal(m.independentlyReplayed,true);
}
{
 const vector=JSON.parse(fs.readFileSync('tests/vectors/product-submission.json')),r=structuredClone(vector.round),manifest=structuredClone(vector.manifest),calls=[];
 const m={...manifest,round:r,sciencePassed:true,partial:false,phase:'candidate-saved-passing-awaiting-submit',salt:'1'.repeat(64)};
 const client={identity:{publicKey:'b'.repeat(64)},round:r,serverNow:1,request:async(action,roundId,payload)=>({action,roundId,payload}),claimState:async id=>{calls.push('lookup');return {status:'REVEALED',receipt:{claimId:id,revealDeadline:9999}};},post:async(path,req)=>{calls.push(path);if(path==='claims')return {claimId:m.claimId,revealDeadline:9999};if(path==='artifacts/uploads')return {uploadId:'upload-'+req.payload.trialIndex,chunks:1,chunkBytes:1024};if(path.endsWith('/status'))return {status:'SEALED',receivedChunks:[0]};return {};}};
 const store={metadata:async()=>m,update:async()=>{},archive:async()=>new Blob([new Uint8Array(480)])};
 const submission=new CandidateSubmissionV2(client,store);await submission.run(m.candidateId);assert.equal(calls.filter(s=>s==='lookup').length,0,'a newly created commitment is posted directly instead of probing a nonexistent claim with GET');assert.equal(calls.filter(s=>s==='claims').length,1);assert.equal(m.phase,'verifying');
 const savedRequest=m.commitRequest;await submission.run(m.candidateId);assert.equal(calls.filter(s=>s==='lookup').length,1,'a saved or uncertain commitment still reconciles through its original claim identity');assert.equal(calls.filter(s=>s==='claims').length,1);assert.equal(m.commitRequest,savedRequest);
}
console.log('Five terminal/queued states preserved; adjudication/vote read race covered; fresh commitments avoid speculative 404 and saved commitments reconcile (synthetic service responses).');
