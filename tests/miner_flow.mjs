// Fault/state tests below are simulations. Real full-model/chain runs are separate E2E tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMinerState, FlowEvents } from '../web/miner-state.mjs';
import { eligibleIndices, sessionGuard } from '../web/task-runner.mjs';
import { inspectStorage, storageBudget } from '../web/model-storage.mjs';
import { entitlementFunds, parseSOL, formatAtoms } from '../web/contribution-view.mjs';
import { submissionPhase, SubmissionController } from '../web/submission-controller.mjs';
import { base58, pk } from '../web/solana-client.mjs';
const catalog=JSON.parse(fs.readFileSync('web/data/task-catalog-dev.json')),config=JSON.parse(fs.readFileSync('web/data/research-config.json')),manifest=JSON.parse(fs.readFileSync('web/data/official-inputs.json'));
const store=new Map();globalThis.localStorage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
const state=createMinerState();state.update('execution',{phase:'running',task:{k:124,bodyId:16789}});state.view('contributions');state.update('submission',{phase:'verifying'});assert.equal(state.value.execution.task.k,124);assert.equal(state.value.execution.phase,'running');assert.throws(()=>state.update('execution',{phase:'accepted'}));
const remaining=eligibleIndices(catalog,{local:[{global_task_index:'0'},{global_task_index:'124'}],preferred:124});assert(!remaining.includes(0)&&!remaining.includes(124));assert.equal(remaining.length,1022);
const queue=Array.from({length:8},()=>({submission:new Uint8Array(32).fill(1),status:0,revealDeadline:200n,verifyDeadline:300n}));
const snapshot={state:{state:1,tge:false},clock:{unixTimestamp:100n,slot:12n},pages:[{k:0n,complete:true,queue},{k:1n,complete:false,queue},{k:2n,complete:false,queue:queue.map(q=>({...q,revealDeadline:99n}))}]};assert.deepEqual(eligibleIndices(catalog,{local:[{global_task_index:'2'}],snapshot}),[]);assert.deepEqual(eligibleIndices(catalog,{snapshot}),[2]);
const rules={submit_deadline:500n,min_reveal_slots:5n};assert.equal(sessionGuard({snapshot,rules,pending:1}),'pending-limit');assert.equal(sessionGuard({snapshot,rules,quote:{max:10n},spent:8n,feeLimit:17n}),'fee-limit');assert.equal(sessionGuard({snapshot,rules,hasServices:false}),'services');assert.equal(sessionGuard({snapshot:{...snapshot,state:{state:2}},rules}),'activity-ended');
const receipt={header:{status:0},lifecycle:{commitSlot:10n,revealDeadlineTs:150n,verifyDeadlineTs:200n,archiveDeadlineTs:250n}};assert.equal(submissionPhase({receipt,snapshot,rules}),'waiting-reveal');assert.equal(submissionPhase({receipt,snapshot:{...snapshot,clock:{slot:15n,unixTimestamp:100n}},rules}),'reveal-authorization');assert.equal(submissionPhase({receipt,snapshot:{...snapshot,clock:{slot:15n,unixTimestamp:151n}},rules}),'timeout');
assert.equal(submissionPhase({receipt:null,snapshot,rules,pending:{transactions:[{status:'unknown'}]}}),'unknown');
const budget=storageBudget(config,manifest,{modelBytes:config.graph_bytes+config.model_bytes,inputs:manifest.sources.map(s=>({id:s.id,bytes:s.bytes}))});assert.equal(budget.download,1109008094);assert.equal(budget.extra,16*1024*1024);assert(budget.browserCache>budget.model);
assert.equal(parseSOL('0.000000001'),1n);assert.equal(parseSOL('123456789.123456789'),123456789123456789n);assert.throws(()=>parseSOL('0.0000000001'));assert.equal(formatAtoms(123456789123456789n),'123456789.123456789');
const address='owner',sdk={pk:x=>({toBase58:()=>x})},ent={beneficiary:address,refundRecipient:address,closed:true,accepted:true,minerWhole:5n,minerClaimed:100000000n,principalReleased:true,principal:50n,advance:2n,refundPaid:false};assert.equal(entitlementFunds(ent,snapshot,address,sdk).claimable,0n);const funds=entitlementFunds(ent,{state:{state:2,tge:true}},address,sdk);assert.equal(funds.claimable,400000000n);assert.equal(funds.refundable,2n);assert.equal(entitlementFunds(ent,{state:{state:2,tge:true}},'different',sdk).claimable,0n);
const events=new FlowEvents({mode:'experience'});events.emit('first-compute');events.emit('first-compute');events.emit('first-compute','complete');assert.equal(events.summary().events.length,2);assert(!JSON.stringify(events.summary()).includes('address'));events.setEnabled(false);events.emit('submit');assert.equal(events.summary().events.length,0);
// Success transfers accepted storage principal to the fixed fund, even before release.
assert.equal(entitlementFunds({...ent,principalReleased:false},{state:{state:2,tge:true}},address,sdk).refundable,2n);
assert.equal(entitlementFunds({...ent,principalReleased:false},{state:{state:3,tge:false}},address,sdk).refundable,52n);
assert.equal(base58(new Uint8Array(32)),pk(new Uint8Array(32)).toBase58());
// Unknown confirmation never triggers resend. Known absence only expires after height.
let sends=0,saved=0,block=50,signatureStatus=null;
const c=new SubmissionController({client:{rules,program:{},connection:{getAccountInfo:async()=>null,getSignatureStatuses:async()=>({value:[signatureStatus]}),getBlockHeight:async()=>block},snapshot:async()=>({...snapshot,pages:[],entitlements:[]}),send:async()=>{sends++;}},wallet:()=>({account:{address:'owner'}}),state,events});c.lock=async fn=>fn('owner');c.sdk={pk:x=>({toBase58:()=>x,toBytes:()=>new Uint8Array(32)}),hex:()=>''};c.store=()=>({save:async()=>{saved++;}});
const p={miner:'owner',submission:'sub',taskId:'task',transactions:[{signature:'sig',lastValidBlockHeight:100,status:'unknown'}]};assert.equal((await c.reconcile(p)).phase,'unknown');await c.continue(p);assert.equal(sends,0);block=101;await c.reconcile(p);assert.equal(p.transactions[0].status,'expired');assert.equal(sends,0);p.transactions[0].status='unknown';signatureStatus={confirmationStatus:'confirmed',err:null};await c.reconcile(p);assert.equal(p.transactions[0].status,'confirmed');assert(saved>=4);
console.log('Miner flow: task eligibility, independent UI state, bounds, TTL, funds precision, event privacy, and unknown-transaction reconciliation passed (faults simulated).');
// Pending fund signatures share the same no-resend rule and a separate durable journal.
const payment={schema:'flypow-funds-v1',miner:'owner',submission:'sub',kind:'claim',transactions:[{signature:'fundsig',lastValidBlockHeight:200,status:'unknown'}]};
c.store=()=>({listFunds:async()=>[payment],saveFunds:async()=>{saved++;}});signatureStatus=null;block=100;
await c.funds('claim',{submission:'sub'});assert.equal(sends,0);assert.equal(c.fundsPending,true);
signatureStatus={confirmationStatus:'confirmed',err:null};await c.reconcileFunds();assert.equal(c.fundsPending,false);assert.equal(payment.transactions[0].status,'confirmed');
c.current={record:{miner:'owner'}};c.walletChanged();assert.equal(c.current,null);assert.equal(state.value.submission.phase,'unsubmitted');
console.log('Funds recovery and wallet identity clearing passed (faults simulated).');
