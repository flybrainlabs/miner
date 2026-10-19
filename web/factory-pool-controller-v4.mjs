import {CandidateStoreV2} from './candidate-store-v2.mjs';
import {say} from './goal-status-text.mjs';
import {FactoryMiningClientV4,FactoryMiningContinuationV4,FactorySubmissionV4,factoryWalletAdapter,verifyPoolManifestV4,verifyPoolCatalogV4,poolDeploymentV4,verifyPoolGoalV4,selectPoolContextV4,FactoryPoolSwitchV4} from '/assets/vendor/generated/factory-wallet-v4.mjs';

// Separate contexts keep every old receipt and archive at its original path.
// Only the selected context controls new computation; previous ones reconcile
// their own submissions and rewards without changing the active Worker reader.
export class FactoryPoolControllerV4 {
  constructor(view){
    this.view=view;this.base=view.factoryDeployment;this.trust=this.base.taskPool?.trust;this.contexts=new Map();this.exhausted=new Set();
    this.current={deployment:this.base,client:view.client,adapter:view.adapter,store:view.store,submission:view.submission,network:view.network,rows:[]};this.contexts.set(this.base.factory,this.current);
    const initial=this.current,snapshot=initial.client.onSnapshot,connection=initial.client.onConnection;
    initial.client.onSnapshot=s=>{initial.knownFactory=s.factory;if(this.current===initial)snapshot(s);};initial.client.onConnection=(...args)=>{if(this.current===initial)connection(...args);};
    this.switcher=new FactoryPoolSwitchV4({runner:view.runner,canSwitch:()=>this.canSwitch(),prepare:async c=>{
      await c.client.sync();if(c.client.round)verifyPoolGoalV4(c.client.round.goal,this.trust);
      if(c!==this.current)await view.walletSetup.policy.include(c.deployment,this.document);
    },commit:c=>this.commit(c)});
    if(this.trust?.anchorFactory!==this.base.factory||this.base.useWebSocket!==false)throw new Error('Pinned pool anchor and bounded polling are required');
    const url=new URL(this.base.taskPool.manifestUrl),api=new URL(this.base.apiBase);
    if(url.origin!==api.origin||url.pathname!=='/api/task-factory/v4/pool'||url.search||url.hash)throw new Error('Pinned pool discovery endpoint required');this.url=url;
    this.key='flybrainlabs-factory-pool-v4:'+this.trust.poolId;
    try{this.previous=JSON.parse(localStorage.getItem(this.key)||'null');}catch{this.previous=null;}
  }
  canSwitch(){const v=this.view,r=v.runner;return (this.explicit&&!r.running||r.running&&r.intent&&!r.paused&&!r.stopAfterRound)&&!r.scheduling&&!v.pending.length&&!r.pendingResults.size&&!v.continuation.pending&&v.walletSetup.canMine&&v.adapter.rpc.ready&&!this.disposed;}
  get hasSupply(){return [...this.contexts.values()].some(c=>c!==this.current&&(c.client.snapshot?.recovery||c.client.round&&c.client.serverNow<c.client.round.pre.claimDeadline||c.knownFactory?.state===1&&!c.knownFactory.paused&&(c.knownFactory.activeIndex!==0xffffffff||c.knownFactory.nextIndex<c.knownFactory.count)));}
  async discover(){
    await verifyPoolCatalogV4(this.base,this.trust,this.view.adapter.connection);
    const response=await fetch(this.url,{cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('POOL_DISCOVERY_UNAVAILABLE');
    const text=await response.text();if(text.length>128*1024)throw new Error('POOL_MANIFEST_SIZE');const document=JSON.parse(text),verified=await verifyPoolManifestV4(document,this.trust,{previous:this.previous});
    // No partially verified manifest is committed to local trust state.
    const prepared=[];
    for(const catalog of verified.body.catalogs){
      if(this.contexts.has(catalog.factory))continue;
      const deployment=poolDeploymentV4(this.base,catalog,this.trust),verifiedCatalog=await verifyPoolCatalogV4(deployment,this.trust,this.view.adapter.connection);prepared.push({deployment,factory:verifiedCatalog.factory});
    }
    for(const {deployment,factory}of prepared)this.contexts.set(deployment.factory,this.createContext(deployment,factory));
    this.document=document;for(const c of this.contexts.values())c.client.poolManifest=document;this.previous={revision:verified.revision,hash:verified.hash};localStorage.setItem(this.key,JSON.stringify(this.previous));this.error=null;
  }
  createContext(deployment,knownFactory){
    const v=this.view,adapter=factoryWalletAdapter({deployment,session:v.financial,rpc:v.adapter.rpc}),c={deployment,knownFactory,adapter,network:{...v.network,campaignId:deployment.factory},rows:[]};
    c.client=new FactoryMiningClientV4({deployment,...adapter,onSnapshot:s=>{c.knownFactory=s.factory;if(this.current===c){v.snapshot=s;v.runner.syncRound(s);v.render();v.onChange?.();}},onConnection:(online,error)=>{if(this.current===c&&!online)v.runner.disconnected(error);}});
    const specification=c.client.specification.bind(c.client);c.client.specification=async task=>{const spec=await specification(task);verifyPoolGoalV4(spec.goal,this.trust);return spec;};
    c.client.assertMiningAuthorization=()=>{adapter.assertMiningAuthorization();v.walletSetup.policy.assertCanMine();};
    c.store=new CandidateStoreV2(c.network);c.store.config=v.store.config;c.submission=new FactorySubmissionV4(c.client,c.store,()=>{this.dirty=true;});c.client.bindWallet();return c;
  }
  commit(c){
    const v=this.view,r=v.runner,old=this.current;if(old===c)return;
    old.rows=v.rows;clearInterval(old.client.timer);old.client.timer=null;
    this.current=c;Object.assign(v,{factoryDeployment:c.deployment,client:c.client,adapter:c.adapter,store:c.store,submission:c.submission,network:c.network,snapshot:c.client.snapshot,rows:c.rows,taskHistory:[],historyAt:0});
    Object.assign(r,{client:c.client,store:c.store,submission:c.submission});r.poolEpoch=(r.poolEpoch||0)+1;
    v.continuation=new FactoryMiningContinuationV4({client:c.client,runner:r,canPay:()=>v.walletSetup.canMine,hasPendingOutputs:()=>!!v.pending.length,onError:error=>v.onError(error)});
    c.client.startPolling();r.syncRound(c.client.snapshot);this.dirty=true;
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
      if(Date.now()-(this.reconciledAt||0)>15000){this.reconciledAt=Date.now();try{await this.reconcilePrevious();}catch{this.reconciliationError='POOL_PREVIOUS_RETRY';}}
      if(!this.canSwitch())return;
      // Query alternatives only when the current task cannot accept new work.
      if(selectPoolContextV4([this.current],this.current,{exhaustedRounds:this.exhausted}))return;
      const alternatives=[...this.contexts.values()].filter(c=>c!==this.current);
      for(let n=0;n<Math.min(4,alternatives.length);n++){const c=alternatives[(this.scanCursor=(this.scanCursor||0)+1)%alternatives.length];if(Date.now()-(c.syncedAt||0)<15000)continue;c.client.bindWallet();try{await c.client.sync();c.syncedAt=Date.now();}catch{}}
      let next=selectPoolContextV4(this.contexts.values(),this.current,{exhaustedRounds:this.exhausted});
      next||=[...this.contexts.values()].find(c=>c.client.online&&c.client.snapshot?.recovery?.kind==='advance');
      if(next&&next!==this.current)await this.switcher.switchTo(next);
    }catch(error){this.error=error.code||'POOL_RETRY_REQUIRED';}finally{this.explicit=false;this.busy=false;}
  }
  renderPrevious(host){
    const rows=[...this.contexts.values()].filter(c=>c!==this.current).flatMap(c=>c.rows.map(m=>({c,m}))).sort((a,b)=>b.m.createdAt-a.m.createdAt).slice(0,40);
    if(!rows.length)return;const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=say('以前目录的计算与奖励','Previous catalogs: computations and rewards');details.append(summary);
    for(const {c,m}of rows){const p=document.createElement('p');p.textContent=c.deployment.factory.slice(0,8)+' · '+m.candidateId.slice(0,12)+' · '+(m.rewardPaid?say('奖励已到账','Reward paid'):m.won?say('奖励待领取','Reward pending'):m.phase);if(m.trials.length){const open=document.createElement('button');open.type='button';open.textContent=say('查看已保存结果','View saved result');open.onclick=()=>c.store.bundle(m).then(b=>this.view.onOpen(b)).catch(this.view.onError);p.append(' ',open);}details.append(p);}host.append(details);
  }
  dispose(){this.disposed=true;this.events?.close();for(const c of this.contexts.values())if(c!==this.current)c.client.dispose();}
}
