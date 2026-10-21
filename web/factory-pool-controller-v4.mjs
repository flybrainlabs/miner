import {CandidateStoreV2} from './candidate-store-v2.mjs';
import {say} from './goal-status-text.mjs';
import {FactoryMiningClientV4,FactoryMiningContinuationV4,FactorySubmissionV4,factoryWalletAdapter,verifyPoolManifestV4,verifyPoolHistoryV4,verifyPoolCatalogV4,poolDeploymentV4,verifyPoolGoalV4,selectPoolContextV4,FactoryPoolSwitchV4} from '/assets/vendor/generated/factory-wallet-v4.mjs';

// Separate contexts keep every old receipt and archive at its original path.
// Only the selected context controls new computation; previous ones reconcile
// their own submissions and rewards without changing the active Worker reader.
export class FactoryPoolControllerV4 {
  constructor(view){
    this.view=view;this.base=view.factoryDeployment;this.trust=this.base.taskPool?.trust;this.contexts=new Map();this.exhausted=new Set();
    this.current={deployment:this.base,client:view.client,adapter:view.adapter,store:view.store,submission:view.submission,network:view.network,rows:[]};this.contexts.set(this.base.factory,this.current);
    const initial=this.current,snapshot=initial.client.onSnapshot,connection=initial.client.onConnection;
    initial.client.onSnapshot=s=>{initial.knownFactory=s.factory;if(this.current===initial)snapshot(s);};initial.client.onConnection=(...args)=>{if(this.current===initial)connection(...args);};
    this.switcher=new FactoryPoolSwitchV4({runner:view.runner,contextSafe:true,canSwitch:()=>this.canSwitch(),prepare:async c=>{
      await c.client.sync();if(c.client.round)verifyPoolGoalV4(c.client.round.goal,this.trust);
      if(c!==this.current)await view.walletSetup.policy.include(c.deployment,this.document);
    },commit:c=>this.commit(c)});
    if(this.trust?.anchorFactory!==this.base.factory||this.base.useWebSocket!==false)throw new Error('Pinned pool anchor and bounded polling are required');
    const url=new URL(this.base.taskPool.manifestUrl),api=new URL(this.base.apiBase);
    if(url.origin!==api.origin||url.pathname!=='/api/task-factory/v4/pool'||url.search||url.hash)throw new Error('Pinned pool discovery endpoint required');this.url=url;
    this.key='flybrainlabs-factory-pool-v4:'+this.trust.poolId;
    try{this.previous=JSON.parse(localStorage.getItem(this.key)||'null');}catch{this.previous=null;}
    try{this.historyFactories=new Set((JSON.parse(localStorage.getItem(this.key+':catalogs')||'[]')).filter(x=>typeof x==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x)).slice(-4096));}catch{this.historyFactories=new Set();}this.archivedStores=new Map();
  }
  canSwitch(){const v=this.view,r=v.runner;return (this.explicit&&!r.running||r.running&&r.intent&&!r.paused&&!r.stopAfterRound)&&!r.scheduling&&!v.pending.length&&!r.pendingResults.size&&v.walletSetup.canMine&&v.adapter.rpc.ready&&!this.disposed;}
  get hasSupply(){return [...this.contexts.values()].some(c=>c!==this.current&&!c.historyOnly&&(c.client.snapshot?.recovery||c.client.round&&c.client.serverNow<c.client.round.pre.claimDeadline||c.knownFactory?.state===1&&!c.knownFactory.paused&&(c.knownFactory.activeIndex!==0xffffffff||c.knownFactory.nextIndex<c.knownFactory.count)));}
  async discover(){
    await verifyPoolCatalogV4(this.base,this.trust,this.view.adapter.connection);
    const response=await fetch(this.url,{cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('POOL_DISCOVERY_UNAVAILABLE');
    const text=await response.text();if(text.length>128*1024)throw new Error('POOL_MANIFEST_SIZE');const document=JSON.parse(text),verified=await verifyPoolManifestV4(document,this.trust,{previous:this.previous});
    // No partially verified manifest is committed to local trust state.
    const prepared=[];
    for(const catalog of verified.body.catalogs){
      this.historyFactories.add(catalog.factory);if(this.contexts.has(catalog.factory)){this.contexts.get(catalog.factory).historyOnly=false;continue;}
      const deployment=poolDeploymentV4(this.base,catalog,this.trust),verifiedCatalog=await verifyPoolCatalogV4(deployment,this.trust,this.view.adapter.connection);prepared.push({deployment,factory:verifiedCatalog.factory});
    }
    const active=new Set(verified.body.catalogs.map(c=>c.factory));for(const c of this.contexts.values())if(!active.has(c.deployment.factory))c.historyOnly=true;
    for(const {deployment,factory}of prepared)this.contexts.set(deployment.factory,this.createContext(deployment,factory));
    this.document=document;for(const c of this.contexts.values())if(!c.historyOnly){c.client.poolManifest=document;c.document=document;}
    localStorage.setItem(this.key+':catalogs',JSON.stringify([...this.historyFactories].slice(-4096)));this.previous={revision:verified.revision,hash:verified.hash};localStorage.setItem(this.key,JSON.stringify(this.previous));this.error=null;
  }
  createContext(deployment,knownFactory){
    const v=this.view,adapter=factoryWalletAdapter({deployment,session:v.financial,rpc:v.adapter.rpc}),c={deployment,knownFactory,adapter,network:{...v.network,campaignId:deployment.factory},rows:[]};
    c.client=new FactoryMiningClientV4({deployment,...adapter,onSnapshot:s=>{c.knownFactory=s.factory;if(this.current===c){v.snapshot=s;v.runner.syncRound(s);v.render();v.onChange?.();}},onConnection:(online,error)=>{if(this.current===c&&!online)v.runner.disconnected(error);}});
    const specification=c.client.specification.bind(c.client);c.client.specification=async task=>{const spec=await specification(task);verifyPoolGoalV4(spec.goal,this.trust);return spec;};
    c.client.assertMiningAuthorization=()=>{adapter.assertMiningAuthorization();v.walletSetup.policy.assertCanMine();};
    c.client.assertSubmissionAuthorization=()=>{adapter.assertMiningAuthorization();v.walletSetup.policy.assertAuthorized();};
    c.store=new CandidateStoreV2(c.network);c.store.config=v.store.config;c.submission=new FactorySubmissionV4(c.client,c.store,()=>{this.dirty=true;});v.configureSubmission(c.submission);c.client.bindWallet();return c;
  }
  async commit(c){
    const v=this.view,r=v.runner,old=this.current;if(old===c)return;
    old.rows=v.rows;clearInterval(old.client.timer);old.client.timer=null;
    this.current=c;Object.assign(v,{factoryDeployment:c.deployment,client:c.client,adapter:c.adapter,store:c.store,submission:c.submission,network:c.network,snapshot:c.client.snapshot,rows:c.rows,taskHistory:[],historyAt:0});
    await r.selectContext(c);
    v.continuation=new FactoryMiningContinuationV4({client:c.client,runner:r,canPay:()=>v.walletSetup.canMine,hasPendingOutputs:()=>!!v.pending.length,onError:error=>v.onError(error)});
    c.client.startPolling();this.dirty=true;
  }
  async reconcilePrevious(){
    const v=this.view,previous=[...this.contexts.values()].filter(c=>c!==this.current);if(!previous.length)return;
    const c=previous[(this.previousCursor=(this.previousCursor||0)+1)%previous.length];c.client.bindWallet();
    await c.client.sync();c.syncedAt=Date.now();c.rows=await c.store.list();
    for(const m of c.rows){
      if(!m.factoryV4?.submission||m.rewardPaid||m.terminalCompetition&&!m.won)continue;
      await c.submission.reconcile(m);
      if(v.runner.running&&v.runner.intent&&!v.runner.paused&&v.walletSetup.canMine&&m.factoryV4.miner===c.client.identity?.publicKey){
        if(m.won&&!m.rewardPaid)await c.submission.pay(m);
        else if(m.phase==='valid')await c.submission.finalize(m);
        else if(['committed','uploading','revealing'].includes(m.phase))await c.submission.submit(m.candidateId);
      }
    }
  }
  async tick({explicit=false}={}){
    if(this.busy||this.disposed||!this.view.adapter.rpc.ready)return;this.busy=true;this.explicit=explicit;
    try{
      if(!this.events&&globalThis.EventSource){const url=new URL('/api/task-factory/v4/events',this.url);this.events=new EventSource(url);this.events.addEventListener('pool-change',()=>{this.discoveredAt=0;this.view.refresh(true).catch(()=>{});});}
      if(Date.now()-(this.discoveredAt||0)>15000){this.discoveredAt=Date.now();await this.discover();}
      const r=this.view.runner;if(r.domainExhausted&&r.round)this.exhausted.add(r.round.roundId);
      // Reconciliation owns its own background lane. A slow upload, payment or
      // confirmation never becomes a prerequisite for selecting new work.
      if(!this.view.outbox&&!this.reconciliationPending&&Date.now()-(this.reconciledAt||0)>15000){this.reconciledAt=Date.now();this.reconciliationPending=this.reconcilePrevious().catch(()=>{this.reconciliationError='POOL_PREVIOUS_RETRY';}).finally(()=>this.reconciliationPending=null);}
      if(!this.historyPending){this.historyPending=this.restoreHistory().catch(()=>{this.historyError='POOL_HISTORY_RETRY';}).finally(()=>this.historyPending=null);}
      if(!this.canSwitch())return;
      const pendingRounds=new Set([...this.contexts.values()].flatMap(c=>(c===this.current?this.view.rows:c.rows).filter(m=>m.sciencePassed&&!m.terminalCompetition&&!['invalid','timed_out'].includes(m.phase)).map(m=>m.roundId)));
      const options={exhaustedRounds:this.exhausted,pendingRounds,minimumSeconds:this.base.taskPool.minimumComputeSeconds||10};
      // Query alternatives only when the current task cannot accept new work.
      if(selectPoolContextV4([this.current],this.current,options))return;
      const alternatives=[...this.contexts.values()].filter(c=>c!==this.current);
      for(let n=0;n<Math.min(4,alternatives.length);n++){const c=alternatives[(this.scanCursor=(this.scanCursor||0)+1)%alternatives.length];if(Date.now()-(c.syncedAt||0)<15000)continue;c.client.bindWallet();try{await c.client.sync();c.syncedAt=Date.now();}catch{}}
      let next=selectPoolContextV4(this.contexts.values(),this.current,options);
      next||=[...this.contexts.values()].find(c=>c!==this.current&&!c.historyOnly&&c.client.online&&['advance','expire','finalize'].includes(c.client.snapshot?.recovery?.kind));
      if(next&&next!==this.current)await this.switcher.switchTo(next);
    }catch(error){this.error=error.code||'POOL_RETRY_REQUIRED';}finally{this.explicit=false;this.busy=false;}
  }
  async restoreHistory(){
    if(!this.historyScanned){
      const root=await navigator.storage.getDirectory();
      for await(const [name,dir]of root.entries())if(dir.kind==='directory'&&name.startsWith('flybrainlabs-candidates-v4-')){
        for await(const [id,candidate]of dir.entries())if(candidate.kind==='directory'&&/^[a-f0-9]{64}$/.test(id)){
          try{const file=await(await candidate.getFileHandle('state.json')).getFile();if(file.size>1048576)continue;const m=JSON.parse(await file.text()),pre=m.round?.pre;if(pre?.protocolVersion===4&&pre.networkId===this.base.genesisHash&&pre.programId===this.base.programId)this.historyFactories.add(pre.factoryAddress);}catch{}break;
        }
      }
      this.historyScanned=true;localStorage.setItem(this.key+':catalogs',JSON.stringify([...this.historyFactories].slice(-4096)));
    }
    const factories=[...this.historyFactories].filter(factory=>!this.contexts.has(factory));
    for(let n=0;n<Math.min(4,factories.length);n++){
      const factory=factories[(this.historyCursor=(this.historyCursor||0)+1)%factories.length];
      const store=new CandidateStoreV2({...this.view.network,campaignId:factory});store.config=this.view.store.config;const rows=await store.list();
      this.archivedStores.set(factory,{deployment:{factory},store,rows});while(this.archivedStores.size>32)this.archivedStores.delete(this.archivedStores.keys().next().value);
      if(!rows.some(m=>!m.rewardPaid&&(!m.terminalCompetition||m.won)&&m.sciencePassed||m.partial))continue;
      const {document,deployment,verified}=await this.historyDocument(factory);
      const context=this.createContext(deployment,verified.factory);context.historyOnly=true;context.document=document;context.needsPolicy=true;context.rows=rows;await context.client.sync();
      this.contexts.set(factory,context);this.archivedStores.delete(factory);
    }
    for(const [factory,c]of this.contexts)if(c!==this.current&&c.historyOnly&&!this.view.runner.active.some(e=>e.context.store===c.store)&&!this.view.outbox?.active.size&&c.rows.length&&!c.rows.some(m=>m.partial||m.sciencePassed&&!m.rewardPaid&&(!m.terminalCompetition||m.won))){c.client.dispose();this.contexts.delete(factory);this.archivedStores.set(factory,c);}
    while(this.archivedStores.size>32)this.archivedStores.delete(this.archivedStores.keys().next().value);
    const policy=this.view.walletSetup.policy;
    if(this.view.walletSetup.ready)for(const context of this.contexts.values())if(context.needsPolicy||context.policyIdentity!==policy){
      if(context.deployment.factory===this.base.factory){context.policyIdentity=policy;continue;}
      if(!context.document||context.document.expiresAt<=Date.now()/1000+30){const history=await this.historyDocument(context.deployment.factory);context.document=history.document;}
      await policy.include(context.deployment,context.document);context.needsPolicy=false;context.policyIdentity=policy;
    }
  }
  async historyDocument(factory){
    const url=new URL('/api/task-factory/v4/pool/catalog/'+factory,this.url),response=await fetch(url,{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('POOL_HISTORY_UNAVAILABLE');const text=await response.text();if(text.length>16384)throw new Error('POOL_HISTORY_SIZE');const document=JSON.parse(text),history=await verifyPoolHistoryV4(document,this.trust,{factory}),deployment=poolDeploymentV4(this.base,history.catalog,this.trust),verified=await verifyPoolCatalogV4(deployment,this.trust,this.view.adapter.connection);
    return {document,deployment,verified};
  }
  renderPrevious(host){
    const rows=[...this.contexts.values(),...this.archivedStores.values()].filter(c=>c!==this.current).flatMap(c=>c.rows.map(m=>({c,m}))).sort((a,b)=>b.m.createdAt-a.m.createdAt).slice(0,40);
    if(!rows.length)return;const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=say('以前目录的计算与奖励','Previous catalogs: computations and rewards');details.append(summary);
    for(const {c,m}of rows){const p=document.createElement('p');p.textContent=c.deployment.factory.slice(0,8)+' · '+m.candidateId.slice(0,12)+' · '+(m.rewardPaid?say('奖励已到账','Reward paid'):m.won?say('奖励待领取','Reward pending'):m.phase);if(m.trials.length){const open=document.createElement('button');open.type='button';open.textContent=say('查看已保存结果','View saved result');open.onclick=()=>c.store.bundle(m).then(b=>this.view.onOpen(b)).catch(this.view.onError);p.append(' ',open);}details.append(p);}host.append(details);
  }
  dispose(){this.disposed=true;this.events?.close();for(const c of this.contexts.values())if(c!==this.current)c.client.dispose();}
}
