import { taskForIndex } from './catalog-task.mjs';
import { decodeResponse } from './response-record.mjs';
import { SubmissionStore } from './submission-store.mjs';
import { FlowError, errorCode } from './miner-state.mjs';
import { entitlementFunds } from './contribution-view.mjs';

export function submissionPhase({receipt,ent,page,snapshot,rules,pending}){
  const state=snapshot.state.state,now=snapshot.clock.unixTimestamp;
  if(ent?.closed){
    if(!ent.refundPaid&&(!ent.accepted||state===2||state===3))return 'refundable';
    return ent.accepted?'accepted':page?.complete?'lost':'timeout';
  }
  if(page?.complete){if(!ent?.accepted&&pending&&page.winner&&pending.submissionBytes&&page.winner.some((v,i)=>v!==pending.submissionBytes[i]))return 'lost';return 'accepted';}
  if(!receipt)return pending?.transactions?.some(t=>t.status==='unknown'||t.status==='sending')?'unknown':'unsubmitted';
  const status=receipt.header.status;
  if(status===3)return 'rejected';
  const expired=(status===0&&now>receipt.lifecycle.revealDeadlineTs)||(status===1&&now>receipt.lifecycle.verifyDeadlineTs)||(status===2&&now>receipt.lifecycle.archiveDeadlineTs);
  if(expired||state===3)return 'timeout';
  if(status===0)return snapshot.clock.slot<receipt.lifecycle.commitSlot+rules.min_reveal_slots?'waiting-reveal':'reveal-authorization';
  if(status===1)return 'verifying';
  if(status===2)return 'revealed';
  return 'unsubmitted';
}
export class SubmissionController {
  constructor({client,catalog,config,wallet,loadBundle,saveBundle,state,events,onChange=()=>{}}){
    Object.assign(this,{client,catalog,config,wallet,loadBundle,saveBundle,state,events,onChange});this.current=null;this.running=false;this.tree=null;this.generation=0;this.abort=null;this.pollTimer=null;this.attempts=0;this.spent=0n;
  }
  store(address=this.wallet()?.account.address){if(!address)throw new FlowError('wallet');return new SubmissionStore(this.client,address);}
  assertWallet(address){const w=this.wallet();if(!w||w.account.address!==address)throw new FlowError('wallet');return w;}
  async lock(action){
    if(this.running)return;const address=this.wallet()?.account.address;if(!address)throw new FlowError('wallet');this.running=true;
    try{return await navigator.locks.request(`flypow-submit-${this.client.config.campaign}-${address}`,{ifAvailable:true},lock=>{if(!lock)throw new FlowError('other-tab');return action(address);});}
    finally{this.running=false;}
  }
  async reconcile(record,{force=false}={}){
    const snap=await this.client.snapshot(),ent=snap.entitlements.find(e=>this.sdk.pk(e.submission).toBase58()===record.submission),page=snap.pages.find(p=>p.task.taskId===record.taskId);
    let receipt=null;const a=await this.client.connection.getAccountInfo(this.sdk.pk(record.submission));if(a?.owner.equals(this.client.program))receipt=await this.client.receipt(record.submission);
    await this.reconcileTransactions(record);
    await this.store(record.miner).save(record);
    record.submissionBytes=Array.from(this.sdk.pk(record.submission).toBytes());
    const unknown=(record.transactions||[]).some(t=>['unknown','sending'].includes(t.status));
    const phase=unknown?'unknown':submissionPhase({receipt,ent,page,snapshot:snap,rules:this.client.rules,pending:record});
    if(this.wallet()?.account.address===record.miner){this.current={record,snapshot:snap,ent,page,receipt,phase};this.state.update('submission',{phase:this.fundsPending?'unknown':phase,taskId:record.taskId,error:null});this.onChange(this.current);}
    return {record,snapshot:snap,ent,page,receipt,phase};
  }
  async reconcileTransactions(record){
    for(const tx of record.transactions||[]){
      if(!['unknown','sending'].includes(tx.status))continue;
      const res=await this.client.connection.getSignatureStatuses([tx.signature],{searchTransactionHistory:true}),s=res.value[0];
      if(s?.err)tx.status='failed';else if(s?.confirmationStatus==='confirmed'||s?.confirmationStatus==='finalized')tx.status='confirmed';else if(BigInt(await this.client.connection.getBlockHeight('confirmed'))>BigInt(tx.lastValidBlockHeight)&&!s)tx.status='expired';
    }
  }
  persist(record){return record.schema==='flypow-funds-v1'?this.store(record.miner).saveFunds(record):this.store(record.miner).save(record);}
  async send(record,step,ixs){
    const address=record.miner,connection=this.assertWallet(address);this.events.emit('signature');this.state.update('submission',{phase:'signature',step});
    try{
      const signature=await this.client.send(connection.wallet,connection.account,ixs,{onSigned:async tx=>{
        this.assertWallet(address);record.transactions??=[];record.transactions.push({...tx,step,status:'sending'});record.step=step;
        await this.persist(record);this.state.update('submission',{phase:'sending',step});
      }});
      const tx=record.transactions.at(-1);tx.status='confirmed';record[step+'Signature']=signature;await this.persist(record);return signature;
    }catch(e){
      const tx=record.transactions?.at(-1);if(tx?.step===step&&tx.status==='sending'){tx.status='unknown';await this.persist(record);if(record.schema==='flypow-funds-v1')this.fundsPending=true;if(this.wallet()?.account.address===address)this.state.update('submission',{phase:'unknown',error:{code:'network'}});}
      else {const phase=step==='commit'?'unsubmitted':step==='reveal'?'reveal-authorization':'revealed';if(this.current)this.current.phase=phase;this.events.emit('signature','failure',errorCode(e));this.state.update('submission',{phase,error:{code:errorCode(e),detail:e.message}});}
      throw e;
    }
  }
  async commit(bundle,{fundingLimit}={}){
    return this.lock(async address=>{
      const sdk=this.sdk,task=bundle.task;await this.client.load();this.client.assertCatalog(this.catalog);
      const snap=await this.client.snapshot();if(snap.state.state!==1||snap.clock.unixTimestamp>this.client.rules.submit_deadline)throw new FlowError('activity-ended');
      const old=(await this.store(address).list()).find(p=>p.taskId===task.taskId);
      if(old){const reconciled=await this.reconcile(old);if(reconciled.receipt||reconciled.ent||reconciled.phase==='unknown'){this.current=reconciled;return reconciled;}}
      if(!bundle.archive)throw new FlowError('damaged','Exact full result is required before submission');
      // Full result and recovery salt are durable before any authorization/payment.
      await this.saveBundle(bundle);
      if(!this.tree){const count=this.catalog.campaign.targets.length*this.catalog.campaign.stimuli.length*this.catalog.campaign.repeats;this.tree=sdk.merkle(await Promise.all(Array.from({length:count},(_,k)=>taskForIndex(this.catalog,k))));}
      if(sdk.hex(this.tree.root)!==sdk.hex(this.client.rules.manifest_root))throw new FlowError('version');
      const q=await this.client.quote();if(fundingLimit!=null&&q.max>fundingLimit)throw new FlowError('fee-limit');
      const salt=crypto.getRandomValues(new Uint8Array(32)),proposal=await this.client.commitInstruction(task,this.tree.proof(task.k),address,address,address,bundle.resultHash,salt,q.max);
      const record={schema:3,campaign:this.client.campaign.toBase58(),miner:address,beneficiary:address,refundRecipient:address,taskId:task.taskId,k:task.k,bodyId:String(task.bodyId),submission:proposal.submission.toBase58(),salt:Array.from(salt),resultRoot:bundle.resultHash,previewRoot:bundle.previewRoot,archiveRoot:bundle.archiveRoot,modelRoot:this.config.model_root_sha256,catalogHash:this.config.task_catalog_sha256,fundingCap:String(q.max),transactions:[]};
      await this.store(address).save(record);this.current={record,phase:'unsubmitted'};this.events.emit('submit');
      await this.send(record,'commit',[proposal.instruction]);this.spent+=q.max;
      const result=await this.reconcile(record);this.watch(record);return result;
    });
  }
  async continue(record=this.current?.record){
    if(!record)throw new FlowError('operation','No saved submission');
    return this.lock(async address=>{
      if(address!==record.miner)throw new FlowError('wallet');
      const checked=await this.reconcile(record),{phase,receipt,page,snapshot}=checked;
      if(phase==='unknown')return checked;
      if(['rejected','timeout','lost','accepted','refundable'].includes(phase))return checked;
      if(!receipt)throw new FlowError('operation','Commit is absent or definitively expired. Recompute or open the exact result before a new explicit submission.');
      if(receipt.header.status===0){
        if(phase==='waiting-reveal'){this.watch(record);return checked;}
        const bundle=await this.loadBundle(await taskForIndex(this.catalog,record.k));
        if(bundle.resultHash!==record.resultRoot||record.modelRoot&&record.modelRoot!==this.config.model_root_sha256||record.catalogHash&&record.catalogHash!==this.config.task_catalog_sha256)throw new FlowError('version');
        const r=decodeResponse(new Uint8Array(bundle.archive),this.config,bundle.task),v=new DataView(bundle.archive);
        const roi=Array.from({length:16},(_,i)=>v.getBigInt64(88+i*8,true)),top=Array.from({length:8},(_,i)=>{const p=344+i*16;return{bodyId:v.getBigUint64(p,true),delta:v.getInt32(p+8,true),firstStep:v.getUint32(p+12,true)};});
        await this.send(record,'reveal',[this.client.revealInstruction(record.submission,address,{taskId:record.taskId,resultRoot:record.resultRoot,previewRoot:bundle.previewRoot,archiveRoot:bundle.archiveRoot,salt:record.salt,global:r.global,roi,time:r.time,top,topCount:r.topCount})]);
      }
      // Archive needs a separate wallet message signature; the UI asks explicitly.
      this.watch(record);return this.reconcile(record);
    });
  }
  async archive(record=this.current?.record){
    return this.lock(async address=>{
      if(address!==record.miner)throw new FlowError('wallet');const checked=await this.reconcile(record);
      if(!checked.receipt||!['revealed','verifying'].includes(checked.phase))return checked;
      const bundle=await this.loadBundle(await taskForIndex(this.catalog,record.k));if(bundle.resultHash!==record.resultRoot)throw new FlowError('damaged');
      this.state.update('submission',{phase:'archiving'});this.abort=new AbortController();
      await this.upload(this.client,this.assertWallet(address),record,bundle,()=>{},this.abort.signal);record.archived=true;await this.store(address).save(record);this.watch(record);return this.reconcile(record);
    });
  }
  async finalize(record=this.current?.record){return this.lock(async address=>{
    if(address!==record.miner)throw new FlowError('wallet');const c=await this.reconcile(record);if(c.phase==='unknown')return c;
    if(c.receipt?.header.status!==2||c.page?.complete||!record.archived)return c;
    const task=await taskForIndex(this.catalog,record.k);await this.send(record,'finalize',[this.client.finalizeInstruction(record.submission,task)]);const result=await this.reconcile(record);if(result.phase==='accepted')this.events.emit('submit','complete');return result;
  });}
  async close(record=this.current?.record){return this.lock(async address=>{
    if(address!==record.miner)throw new FlowError('wallet');const c=await this.reconcile(record);if(c.phase==='unknown'||!c.receipt||!['accepted','lost','rejected','timeout'].includes(c.phase))return c;
    await this.send(record,'close',[this.client.closeInstruction(record.submission,await taskForIndex(this.catalog,record.k))]);return this.reconcile(record);
  });}
  async watch(record){
    clearTimeout(this.pollTimer);const generation=this.generation;this.attempts=0;
    const poll=async()=>{
      if(generation!==this.generation||document.hidden||this.wallet()?.account.address!==record.miner)return;
      try{const c=await this.reconcile(record);this.attempts++;if(['waiting-reveal','verifying','unknown'].includes(c.phase)&&this.attempts<12)this.pollTimer=setTimeout(poll,Math.min(30000,2000*2**Math.min(this.attempts,4)));}
      catch{if(++this.attempts<6)this.pollTimer=setTimeout(poll,Math.min(30000,3000*2**this.attempts));}
    };
    this.pollTimer=setTimeout(poll,2000);
  }
  async reconcileFunds(address=this.wallet()?.account.address){
    if(!address)return [];
    const snap=await this.client.snapshot(),records=await this.store(address).listFunds();
    for(const r of records){
      await this.reconcileTransactions(r);
      const ent=snap.entitlements.find(e=>this.sdk.pk(e.submission).toBase58()===r.submission);
      if(ent&&(r.kind==='refund'?ent.refundPaid:r.targetClaimAtoms!=null&&ent.minerClaimed>=BigInt(r.targetClaimAtoms)))for(const t of r.transactions)if(['unknown','sending'].includes(t.status))t.status='settled';
      await this.store(address).saveFunds(r);
    }
    if(this.wallet()?.account.address===address){
      this.fundsPending=records.some(r=>r.transactions.some(t=>['unknown','sending'].includes(t.status)));
      if(this.fundsPending)this.state.update('submission',{phase:'unknown',step:'funds'});
    }
    return records;
  }
  async funds(kind,ent){return this.lock(async address=>{
    // Read old signatures first. An unknown payment never becomes a new wallet request.
    await this.reconcileFunds(address);if(this.fundsPending)return;
    const snap=await this.client.snapshot(),sub=this.sdk.pk(ent.submission).toBase58(),actual=snap.entitlements.find(e=>this.sdk.pk(e.submission).toBase58()===sub);
    if(!actual)throw new FlowError('operation');const f=entitlementFunds(actual,snap,address,this.sdk);
    const ixs=kind==='refund'?f.refundable?[this.client.refundInstruction(sub,actual.bodyId,actual.refundRecipient)]:[]:f.claimable?this.client.claimInstructions(sub,0,0,actual.beneficiary,address,f.claimable):[];
    if(!ixs.length)return;
    const old=(await this.store(address).listFunds()).find(r=>r.submission===sub&&r.kind===kind),record=old||{schema:'flypow-funds-v1',campaign:this.client.campaign.toBase58(),miner:address,submission:sub,kind,transactions:[]};
    if(kind==='claim')record.targetClaimAtoms=String(actual.minerClaimed+f.claimable);
    await this.store(address).saveFunds(record);await this.send(record,kind,ixs);await this.reconcileFunds(address);
    if(this.current)await this.reconcile(this.current.record);else this.state.update('submission',{phase:'unsubmitted'});
  });}
  walletChanged(){this.generation++;clearTimeout(this.pollTimer);this.abort?.abort();this.current=null;this.fundsPending=false;this.state.update('submission',{phase:'unsubmitted',taskId:null,error:null});}
  dispose(){this.walletChanged();}
}
