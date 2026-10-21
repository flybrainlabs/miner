// Wallet-owned commit/reveal. A node cannot select a goal or rewrite its rules.
import {PublicKey} from '@solana/web3.js';
import {createAssociatedTokenAccountIdempotentInstruction,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {instruction,meta,system,TOKEN_PROGRAM_ID} from './task-factory-transactions-v4.mjs';
import {canonical,hash,hex,goalResultRoot} from './target-protocol-v2.mjs';
import {commitment,fromHex,STATE} from './task-factory-v4-codec.mjs';
import {validateFactoryManifest} from './task-factory-v4-science.mjs';
export class FactorySubmissionV4 {
  constructor(client,store,onChange=()=>{}){Object.assign(this,{client,store,onChange});this.active=new Map();}
  submit(candidateId){if(this.active.has(candidateId))return this.active.get(candidateId);const promise=this.lock(candidateId,()=>this.run(candidateId)).finally(()=>this.active.delete(candidateId));this.active.set(candidateId,promise);return promise;}
  lock(candidateId,fn){const locks=globalThis.navigator?.locks;if(locks)return locks.request('flybrain-candidate-v4:'+this.client.deployment.factory+':'+candidateId,{},fn);if(typeof window!=='undefined')throw new Error('Cross-tab candidate coordination unavailable');return fn();}
  async changed(m,phase){m.phase=phase;await this.store.update(m);this.onChange(m);return m;}
  async run(candidateId){
    const m=await this.store.metadata(candidateId),r=m.round,c=this.client;
    const identity=c.identity?.publicKey,wallet=String(c.wallet.publicKey),generation=c.generation;
    const guard=stage=>{if(stage==='commit')c.assertMiningAuthorization?.();else (c.assertSubmissionAuthorization||c.assertMiningAuthorization)?.();if(c.identity?.publicKey!==identity||String(c.wallet.publicKey)!==wallet||c.generation!==generation)throw Object.assign(new Error('Original submission identity changed'),{code:'SUBMISSION_IDENTITY_CHANGED'});if((stage==='commit'?this.canCommit:this.canFinish)?.(m)===false)throw Object.assign(new Error('Submission signing is paused'),{code:'SUBMISSION_PAUSED'});};
    if(r.pre.protocolVersion!==4||!m.sciencePassed||m.partial)throw new Error('Only a saved complete V4 result can submit');
    const {f,t,r:verified}=await c.roundAt(r.pre.taskIndex);
    if(verified.roundId!==r.roundId)throw new Error('Original task attempt changed; saved artifacts retained');
    const miner=new PublicKey(c.wallet.publicKey),minerHex=hex(miner.toBytes()),factory=c.reader.expected.factoryAddress,task=c.reader.a.task(factory,t.index);
    if(m.factoryV4&&m.factoryV4.miner!==minerHex)throw new Error('Reconnect the original wallet');
    const manifest={schema:'flybrainlabs-candidate-manifest-v4',roundId:r.roundId,goalId:m.goalId,candidateId:m.candidateId,input:m.input,trials:m.trials,goalResultRoot:await goalResultRoot(m.trials)};
    await validateFactoryManifest(manifest,r);
    const archive={schema:'flybrainlabs-candidate-archive-v4',trials:m.trials.map(t=>({root:t.resultRoot,bytes:t.bytes}))},manifestBytes=canonical(manifest),archiveBytes=canonical(archive);
    const evidence={candidate:fromHex(m.candidateId),result:fromHex(manifest.goalResultRoot),manifest:fromHex(await hash(manifestBytes)),archive:fromHex(await hash(archiveBytes))};
    m.factoryV4||={miner:minerHex,salt:hex(crypto.getRandomValues(new Uint8Array(32)))};const salt=fromHex(m.factoryV4.salt),commit=commitment(c.reader.program,f,task,t.attempt,miner,miner,evidence,salt),address=c.reader.a.submission(task,t.attempt,miner,commit);
    m.factoryV4.submission=address.toBase58();m.manifest=manifest;m.claimId=hex(address.toBytes());await this.changed(m,'submitting-commitment');
    let existing=await c.reader.connection.getAccountInfo(address,'finalized');
    if(!existing){guard('commit');if(t.state!==STATE.ACTIVE)throw new Error('Task is no longer active');await c.send([instruction(c.reader.program,[meta(factory),meta(task,true),meta(address,true),meta(miner,false,true),meta(miner,true,true),system()],4,{commitment:commit,beneficiary:miner})],{priority:10,replacementSafe:false,beforeSend:()=>guard('commit')});}
    let s=await c.reader.submission(address,task);if(s.state!==STATE.COMMITTED)return this._reconcile(m);
    await this.changed(m,'uploading');
    guard('reveal');await c.contentStore.begin?.({submission:address.toBase58(),manifest,archive,salt:hex(salt)});
    for(let j=0;j<m.trials.length;j++){guard('reveal');await c.contentStore.put(m.trials[j].resultRoot,await this.store.archive(m,j));}
    await c.contentStore.put(hex(evidence.manifest),manifestBytes);await c.contentStore.put(hex(evidence.archive),archiveBytes);
    // A separate slot protects the commitment. This is not round pacing.
    const limit=Date.now()+15000;while(BigInt(await c.reader.connection.getSlot('finalized'))<=s.commitSlot){if(Date.now()>limit)throw new Error('Waiting for finalized commitment; retry reveal');await new Promise(done=>setTimeout(done,500));}
    await this.changed(m,'revealing');guard('reveal');await c.send([instruction(c.reader.program,[meta(factory),meta(task,true),meta(address,true),meta(miner,false,true)],5,{evidence,salt})],{priority:100,replacementSafe:false,beforeSend:()=>guard('reveal')});return this.changed(m,'verifying');
  }
  reconcile(m){return this.lock(m.candidateId,async()=>{const current=await this.store.metadata(m.candidateId);const result=await this._reconcile(current);Object.assign(m,result);return result;});}
  async _reconcile(m){
    if(!m.factoryV4?.submission)return m;const c=this.client,task=c.reader.a.task(c.deployment.factory,m.round.pre.taskIndex),s=await c.reader.submission(m.factoryV4.submission,task),t=await c.reader.task(m.round.pre.taskIndex);
    m.won=t.state===STATE.SOLVED&&hex(t.winner)===m.claimId;m.independentlyReplayed=s.state===STATE.VALID;m.validVotes=s.validVotes.toString(2).replace(/0/g,'').length;m.invalidVotes=s.invalidVotes.toString(2).replace(/0/g,'').length;
    const expired=t.attempt!==s.attempt||t.state===STATE.FAILED||s.state===STATE.COMMITTED&&c.serverNow>Number(t.revealDeadline)||s.state===STATE.REVEALED&&c.serverNow>Number(t.verifyDeadline);
    m.terminalCompetition=m.won||t.state===STATE.SOLVED||s.state===STATE.INVALID||expired;m.rewardPaid=m.won&&t.paid;
    return this.changed(m,m.won?'winner-confirmed':s.state===STATE.INVALID?'invalid':expired?'timed_out':s.state===STATE.VALID?'valid':s.state===STATE.REVEALED?'verifying':'committed');
  }
  finalize(m){return this.lock(m.candidateId,()=>this._finalize(m));}
  async _finalize(m){
    if([STATE.SOLVED,STATE.FAILED].includes((await this.client.reader.task(m.round.pre.taskIndex)).state))return this._reconcile(m);
    const c=this.client,f=await c.reader.factory(),task=c.reader.a.task(c.deployment.factory,m.round.pre.taskIndex),keys=[meta(c.deployment.factory,true),meta(task,true),meta(m.factoryV4.submission)];
    if(f.nextIndex<f.count)keys.push(meta(c.reader.a.task(c.deployment.factory,f.nextIndex),true));
    await c.send([instruction(c.reader.program,keys,7)],{beforeSend:()=>{if(this.canCommit&&!this.canCommit(m))throw new Error('Settlement paused');}});await c.sync();return this._reconcile(m);
  }
  pay(m){return this.lock(m.candidateId,()=>this._pay(m));}
  async _pay(m){
    const c=this.client,t=await c.reader.task(m.round.pre.taskIndex);if(t.paid)return this._reconcile(m);const beneficiary=new PublicKey(t.beneficiary),miner=new PublicKey(c.wallet.publicKey),f=await c.reader.factory(),mint=new PublicKey(f.mint),ata=getAssociatedTokenAddressSync(mint,beneficiary);
    const task=c.reader.a.task(c.deployment.factory,m.round.pre.taskIndex);
    await c.send([createAssociatedTokenAccountIdempotentInstruction(miner,ata,beneficiary,mint),instruction(c.reader.program,[meta(c.reader.a.global),meta(c.deployment.factory,true),meta(task,true),meta(m.factoryV4.submission),meta(c.reader.a.pool(0),true),meta(ata,true),meta(TOKEN_PROGRAM_ID)],9)],{beforeSend:()=>{if(this.canCommit&&!this.canCommit(m))throw new Error('Payment paused');}});return this._reconcile(m);
  }
}
