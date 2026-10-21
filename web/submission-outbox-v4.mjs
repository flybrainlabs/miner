// Candidate state.json is the durable handoff. A restart scans complete saved
// candidates, including a crash between saving the final trial and enqueueing.
const committed = m => !!m.factoryV4?.submission;
const retryDelay = attempts => Math.min(60000, 1000 * 2 ** Math.min(6, attempts)) + Math.floor(Math.random() * 1000);
export class SubmissionOutboxV4 {
  constructor({contexts,canCommit,canFinish,onChange=()=>{},onCandidate=()=>{},maximumActive=2,maximumCandidates=32,maximumBytes=1024**3}) {
    Object.assign(this,{contexts,canCommit,canFinish,onChange,onCandidate,maximumActive,maximumCandidates,maximumBytes});
    this.active=new Map();this.errors=new Map();this.pending=new Map();this.inventory=new Map();this.stopped=false;this.ready=false;
  }
  observe(meta){const key=meta.roundId+':'+meta.candidateId;if(meta.sciencePassed&&!meta.partial&&!meta.rewardPaid&&(!meta.terminalCompetition||meta.won))this.pending.set(key,meta.trials.reduce((n,t)=>n+t.bytes,0));else this.pending.delete(key);this.onCandidate(meta);}
  canAccept(reservation=0,inFlight=0){const totals=this.snapshot();return this.ready&&totals.pending+Math.ceil(inFlight/Math.max(1,reservation))<this.maximumCandidates&&totals.bytes+reservation+inFlight<=this.maximumBytes;}
  async enqueue(store,meta) {
    if(meta.partial||!meta.sciencePassed||!meta.archiveSaved)throw new Error('Complete durable candidate required');
    meta.outbox||={version:1,queuedAt:Date.now(),attempts:0,retryAt:0};
    await store.update(meta);this.observe(meta);return meta;
  }
  eligible(c,m) {
    const wallet=c.client.identity?.publicKey;
    if(!wallet||m.partial||!m.sciencePassed||m.rewardPaid||m.terminalCompetition&&!m.won)return false;
    const original=m.factoryV4?.miner||m.executionScope?.walletIdentity;
    const legacyWallet=m.financialScope?.wallet;
    if(original?original!==wallet:!legacyWallet||legacyWallet!==String(c.client.wallet?.publicKey))return false;
    return committed(m)?this.canFinish(c,m):this.canCommit(c,m);
  }
  async tick() {
    if(this.scanning||this.stopped)return;this.scanning=true;
    try {
      const selected=[],seen=new Set(),before=new Map(this.pending),inventory=new Map();
      for(const c of this.contexts()) {
        c.client.bindWallet?.();const rows=await c.store.list({activeOnly:true,limit:1000});c.rows=rows;for(const m of rows){this.observe(m);seen.add(m.roundId+':'+m.candidateId);}if(c.store.usage){const usage=await c.store.usage();inventory.set(c.deployment.factory,{count:usage.active,bytes:usage.activeBytes||0});}
        c.submission.canCommit=m=>this.canCommit(c,m);c.submission.canFinish=m=>this.canFinish(c,m);
        for(const m of rows)if(this.eligible(c,m)&&(m.outbox?.retryAt||0)<=Date.now())selected.push({c,m});
      }
      for(const [key,value]of before)if(!seen.has(key)&&this.pending.get(key)===value)this.pending.delete(key);
      this.inventory=inventory;this.ready=true;
      selected.sort((a,b)=>Number(committed(b.m))-Number(committed(a.m))||a.m.createdAt-b.m.createdAt);
      for(const {c,m}of selected) {
        const key=c.deployment.factory+':'+m.candidateId;
        if(this.active.has(key))continue;
        if(this.active.size>=this.maximumActive)break;
        const work=this.drive(c,m).catch(error=>this.errors.set(key,error.code||'SUBMISSION_RETRY')).finally(()=>{this.active.delete(key);this.onChange();});
        this.active.set(key,work);
      }
    } catch(error){this.ready=false;throw error;} finally {this.scanning=false;}
  }
  async drive(c,meta) {
    const action=async()=>{
      let m=await c.store.metadata(meta.candidateId);if(!this.eligible(c,m))return;
      try {
        if(m.factoryV4?.submission)await c.submission.reconcile(m);
        m=await c.store.metadata(meta.candidateId);
        if(m.rewardPaid||m.terminalCompetition&&!m.won){this.observe(m);return;}
        if(m.won){if(this.canCommit(c,m))await c.submission.pay(m);}
        else if(m.phase==='valid'){if(this.canCommit(c,m))await c.submission.finalize(m);}
        else if(!['verifying','invalid','timed_out','winner-confirmed'].includes(m.phase))await c.submission.submit(m.candidateId);
        m=await c.store.metadata(meta.candidateId);m.outbox={...m.outbox,version:1,attempts:0,retryAt:Date.now()+5000,lastSuccessAt:Date.now()};await c.store.update(m);this.observe(m);this.errors.delete(c.deployment.factory+':'+m.candidateId);
      } catch(error) {
        m=await c.store.metadata(meta.candidateId);const attempts=(m.outbox?.attempts||0)+1;
        m.outbox={...m.outbox,version:1,attempts,retryAt:Date.now()+retryDelay(attempts),lastError:error.code||'SUBMISSION_RETRY'};
        await c.store.update(m);throw error;
      }
    };
    if(!globalThis.navigator?.locks)throw new Error('Cross-tab submission coordination unavailable');
    return navigator.locks.request('flybrain-outbox-v4:'+c.deployment.factory+':'+meta.candidateId,{ifAvailable:true},lock=>lock?action():undefined);
  }
  snapshot() {return {active:this.active.size,errors:this.errors.size,pending:Math.max(this.pending.size,[...this.inventory.values()].reduce((n,v)=>n+v.count,0)),bytes:Math.max([...this.pending.values()].reduce((n,b)=>n+b,0),[...this.inventory.values()].reduce((n,v)=>n+v.bytes,0)),maximumCandidates:this.maximumCandidates,maximumBytes:this.maximumBytes};}
  stop() {this.stopped=true;}
}
