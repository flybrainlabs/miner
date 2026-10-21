import assert from 'node:assert/strict';
import {SubmissionOutboxV4} from '../web/submission-outbox-v4.mjs';
const flush=()=>new Promise(setImmediate),clone=value=>structuredClone(value);
const deferred=()=>{let resolve;const promise=new Promise(ok=>resolve=ok);return {promise,resolve};};
// Shared lock server models two independent tabs. Persistence and chain I/O are
// fixtures here; OPFS crash recovery has separate real-store coverage.
const held=new Set();
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{async request(key,options,fn){if(held.has(key)){assert(options.ifAvailable);return fn(null);}held.add(key);try{return await fn({name:key});}finally{held.delete(key);}}}}});
const candidate=(id,{committed=false,bytes=60}={})=>({candidateId:id,roundId:'round-'+id,createdAt:id.charCodeAt(0),sciencePassed:true,archiveSaved:true,partial:false,trials:[{bytes}],phase:committed?'uploading':'candidate-saved-passing-awaiting-submit',executionScope:{walletIdentity:'wallet-a'},...(committed?{factoryV4:{submission:'submission-'+id,miner:'wallet-a'}}:{})});
const fixture=(factory,initial)=>{
 const rows=new Map(initial.map(m=>[m.candidateId,clone(m)]));
 const c={deployment:{factory},client:{identity:{publicKey:'wallet-a'},bindWallet(){}},store:{async list(){return [...rows.values()].filter(m=>!m.rewardPaid&&(!m.terminalCompetition||m.won)).map(clone);},async metadata(id){return clone(rows.get(id));},async update(m){rows.set(m.candidateId,clone(m));}}};
 return {c,rows};
};
let running=true,authorized=true;const make=contexts=>new SubmissionOutboxV4({contexts:()=>contexts,canCommit:()=>running&&authorized,canFinish:()=>authorized,maximumActive:2,maximumCandidates:4,maximumBytes:240});
{
 const a=fixture('factory-a',[candidate('a',{committed:true}),candidate('b'),candidate('c')]),b=fixture('factory-b',[candidate('d')]),upload=deferred(),started=[];
 for(const {c,rows}of [a,b])c.submission={async reconcile(m){return m;},async submit(id){started.push(c.deployment.factory+':'+id);if(id==='a')await upload.promise;const m=clone(rows.get(id));m.factoryV4={submission:'submission-'+id,miner:'wallet-a'};m.phase='verifying';rows.set(id,m);}};
 const outbox=make([a.c,b.c]);assert(!outbox.canAccept(60));await outbox.tick();await flush();
 assert.deepEqual([...started].sort(),['factory-a:a','factory-a:b']);assert.equal(outbox.active.size,1,'hung old upload does not retain completed lane');
 await outbox.tick();await flush();assert(started.includes('factory-a:c'));await outbox.tick();await flush();assert(started.includes('factory-b:d'),'other catalog progresses during the hung original upload');assert(outbox.active.size<=2);assert(!outbox.canAccept(60));
 for(const {rows}of [a,b])for(const [id,m]of rows)if(id!=='a')rows.set(id,{...m,terminalCompetition:true});
 await outbox.tick();await flush();assert.equal(outbox.snapshot().pending,1);assert(outbox.canAccept(60),'terminal results release count and byte capacity');
 upload.resolve();await Promise.all(outbox.active.values());
 // A recreated outbox recovers durable original candidates, including the
 // crash boundary where there is no outbox marker yet.
 const restart=make([a.c,b.c]);assert(!restart.canAccept(60));await restart.tick();await Promise.all(restart.active.values());assert.equal(restart.snapshot().pending,1);
}
{
 const f=fixture('shared-factory',[candidate('s')]),gate=deferred();let calls=0;
 f.c.submission={async submit(){calls++;await gate.promise;},async reconcile(){}};
 const left=make([f.c]),right=make([f.c]);await Promise.all([left.tick(),right.tick()]);await flush();assert.equal(calls,1,'two tabs share one candidate operation lock');gate.resolve();await Promise.all([...left.active.values(),...right.active.values()]);
}
{
 const f=fixture('pause-factory',[candidate('u'),candidate('v',{committed:true})]),calls=[];
 f.c.submission={async reconcile(){},async submit(id){calls.push(id);}};
 const box=make([f.c]);running=false;await box.tick();await Promise.all(box.active.values());assert.deepEqual(calls,['v'],'Pause permits only necessary original committed work');
 authorized=false;const locked=make([f.c]);await locked.tick();assert.equal(locked.active.size,0);assert.deepEqual(calls,['v']);
 authorized=true;running=true;f.c.client.identity.publicKey='other-wallet';const wrong=make([f.c]);await wrong.tick();assert.equal(wrong.active.size,0,'a new wallet cannot inherit the original submission');
 f.c.client.identity.publicKey='wallet-a';const stopped=make([f.c]);stopped.stop();await stopped.tick();assert.equal(stopped.active.size,0);
}
{
 const f=fixture('retry-factory',[candidate('r')]);let calls=0;
 f.c.submission={async submit(){calls++;throw Object.assign(new Error('Unavailable'),{code:'UPLOAD_503'});}};
 const box=make([f.c]);await box.tick();await Promise.all(box.active.values());const saved=f.rows.get('r');assert.equal(saved.outbox.attempts,1);assert(saved.outbox.retryAt>Date.now());assert.equal(saved.outbox.lastError,'UPLOAD_503');await box.tick();await flush();assert.equal(calls,1,'persisted backoff prevents a busy retry loop');assert.equal(box.snapshot().pending,1);
}
{
 const meta=candidate('l');delete meta.executionScope;meta.financialScope={wallet:'legacy-wallet'};const f=fixture('legacy-factory',[meta]);f.c.client.wallet={publicKey:'legacy-wallet'};let calls=0;f.c.submission={submit:async()=>{calls++;}};const box=make([f.c]);await box.tick();await Promise.all(box.active.values());assert.equal(calls,1,'a preserved original financial scope can recover a pre-outbox candidate');f.c.client.wallet.publicKey='another-wallet';assert(!box.eligible(f.c,meta));
}
console.log(JSON.stringify({passed:true,cases:5,scope:'Actual outbox with isolated durable metadata and shared-lock fixtures; hung upload, independent catalogs, count/byte capacity recovery, restart, pause/stop/identity, two tabs, persisted retry; no chain I/O'}));
