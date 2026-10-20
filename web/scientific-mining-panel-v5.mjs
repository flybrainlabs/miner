import {ScientificClientV5,ScientificWalletPolicyV5,FactoryContentStoreV4,pk,hex,uploadMessage} from '/assets/vendor/generated/scientific-v5.mjs';
import {ScientificMiningRunnerV5,ScientificJournalV5} from './scientific-mining-v5.mjs';
const chinese=()=>document.documentElement.lang.startsWith('zh'),say=(zh,en)=>chinese()?zh:en;
const make=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
const labels={searching:['寻找低成本干预','Searching for a low-cost intervention'],'waiting-commit-window':['等待提交窗口','Waiting for the commitment window'],'no-qualifying-intervention':['本次搜索尚未找到达标干预','No qualifying intervention found in this search'],'commit-window-closed':['提交窗口已关闭','Commitment window closed'],'committing-input':['登记干预承诺','Committing the intervention'],'waiting-public-challenge':['等待公开背景挑战','Waiting for the public background challenge'],computing:['计算完整模型','Computing the complete model'],'publishing-evidence':['发布可复验的证据','Publishing reproducible evidence'],'awaiting-node-verification':['等待节点核验','Waiting for node verification'],'accepted-awaiting-payment':['贡献已接受，等待结算','Contribution accepted; awaiting payment'],paid:['奖励已结算','Reward settled'],rejected:['本次贡献未获得奖励资格','Contribution did not qualify'],duplicate:['该计算贡献已登记','This computation was already registered'],paused:['已暂停，计算记录保留','Paused; computed records are retained']};
function workerPort(reader,address){const ch=new MessageChannel();let requests=0;ch.port1.onmessage=async({data:m})=>{try{if(++requests>8||!Number.isSafeInteger(m.id))throw new Error();let value;if(m.method==='getGenesisHash')value=await reader.connection.getGenesisHash();else if(m.method==='getAccountInfo'&&m.address===address){const a=await reader.connection.getAccountInfo(pk(address),'finalized');value=a?{owner:a.owner.toBase58(),data:new Uint8Array(a.data)}:null;}else throw new Error();ch.port1.postMessage({id:m.id,value});}catch{ch.port1.postMessage({id:m.id,error:'Scientific account read unavailable'});}};ch.port1.start();return {port:ch.port2,close(){ch.port1.close();ch.port2.close();}};}
export class ScientificMiningPanelV5 {
  constructor(view,deployment){
    Object.assign(this,{view,deployment,running:false});this.root=make('section');this.root.id='scientific-mining-v5';this.root.className='miner-card';this.root.setAttribute('aria-labelledby','science-title');
    this.title=make('h2');this.title.id='science-title';this.description=make('p');this.status=make('p');this.status.setAttribute('role','status');this.evidence=make('p');this.cost=make('p');
    this.role=make('select');this.role.setAttribute('aria-label',say('科学贡献类别','Scientific contribution role'));
    for(const [value,zh,en]of [['0:255','发现 · 6 个名额','Discovery · 6 places'],['1:0','复现 A','Reproduction A'],['1:1','复现 B','Reproduction B'],['2:0','压力测试 A','Stress test A'],['2:1','压力测试 B','Stress test B']]){const o=make('option',say(zh,en));o.value=value;this.role.append(o);}
    this.start=make('button');this.start.type='button';this.stop=make('button',say('暂停科学挖矿','Pause scientific mining'));this.stop.type='button';this.download=make('button',say('下载实验记录','Download experiment record'));this.download.type='button';this.download.disabled=true;this.receipts=make('ul');
    this.consent=make('input');this.consent.type='checkbox';this.consent.id='science-auto-pay-consent';const consent=make('label');consent.htmlFor=this.consent.id;consent.append(this.consent,document.createTextNode(say('允许专用钱包为已公布的科学轮次自动支付 Solana 费用与账户租金。没有项目服务费，不设消费预算。','Allow the dedicated wallet to pay Solana fees and account rent for the published scientific rounds. There is no project service fee or spending budget.')));
    this.root.append(this.title,this.description,this.status,this.role,this.cost,consent,this.start,this.stop,this.evidence,this.download,this.receipts);document.getElementById('miner-computation').after(this.root);
    this.start.onclick=()=>this.begin().catch(error=>{this.error=error.message;this.status.textContent=say('科学挖矿需要处理：','Scientific mining needs attention: ')+error.message;this.render();});this.stop.onclick=()=>{this.intent=false;this.runner?.stop();};this.download.onclick=()=>this.export();this.entitlementTimer=setInterval(()=>this.refreshEntitlements().catch(()=>{}),10000);this.render();
  }
  render(){
    this.title.textContent=say('科学挖矿：让结果经得起复验','Scientific mining: evidence you can reproduce');
    this.description.textContent=say('每轮最多 6 项发现、2 项复现、2 项压力测试。正确完成的指定压力测试，即使结论是否定，也有奖励资格。计算正确、科学达标和奖励到账分别展示。','Each round has up to 6 discoveries, 2 reproductions and 2 stress tests. Correct assigned stress tests can qualify even with a negative outcome. Computation correctness, scientific qualification and payment are shown separately.');
    const enabled=this.deployment.enabled===true;this.start.textContent=say('开始科学挖矿','Start scientific mining');this.start.disabled=!enabled||this.running||!this.view.runtime.ready||!this.view.walletSetup?.canMine||this.view.runner.running;this.stop.disabled=!this.running;this.role.disabled=this.running;this.consent.disabled=this.running;
    if(!enabled)this.status.textContent=say('科学轮次尚未开放。现有挖矿与待结算结果继续按原规则处理。','Scientific rounds are not open yet. Existing mining and pending results continue under their registered rules.');
    else if(!this.running&&!this.error)this.status.textContent=say('使用上方的个人 RPC、专用钱包与完整模型参与。','Use your personal RPC, dedicated wallet and complete model prepared above.');
    if(enabled&&this.error)this.status.textContent=say('科学挖矿需要处理：','Scientific mining needs attention: ')+this.error;
    else if(enabled&&this.latest)this.status.textContent=labels[this.latest.phase]?.[chinese()?0:1]||this.latest.phase;
    this.stop.textContent=say('暂停科学挖矿','Pause scientific mining');this.download.textContent=say('下载实验记录','Download experiment record');
  }
  async begin(){
    if(this.running||!this.deployment.enabled||!this.consent.checked)throw new Error(say('请先确认科学轮次的自动支付范围','Confirm the automatic-payment scope for scientific rounds'));
    const v=this.view;v.adapter.rpc.assertReady();if(v.runner.running||!v.runtime.ready||!v.walletSetup.canMine)throw new Error(say('请先准备模型、解锁钱包并停止当前计算','Prepare the model, unlock the wallet and stop the current computation first'));
    const base=v.walletSetup.policy,policy=new ScientificWalletPolicyV5({deployment:this.deployment,connection:v.adapter.connection,address:v.walletSetup.vault.address,basePolicy:base});
    const quote=await policy.quote();this.cost.textContent=say(`每份提交账户租金：${quote.submissionRentLamports} lamports；交易费按个人 RPC 实时报价。`,`Claim account rent: ${quote.submissionRentLamports} lamports; transaction fees are quoted by your personal RPC.`);
    await policy.approve();v.walletSetup.vault.policy=policy;this.running=true;this.intent=true;this.error=null;v.render();
    const previous={onCompute:v.runtime.onCompute,onLive:v.runtime.onLive,onControl:v.runtime.onControl};
    v.runtime.onLive=()=>{};v.runtime.onCompute=m=>{this.evidence.textContent=say(`实际神经元更新 ${m.neuronUpdates}；突触累加 ${m.synapseTransmissions}；模型进度 ${m.completedSteps}/${m.totalSteps}。`,`Actual neuron updates ${m.neuronUpdates}; synaptic additions ${m.synapseTransmissions}; model progress ${m.completedSteps}/${m.totalSteps}.`);};
    const wallet={get publicKey(){return pk(v.financial.account.publicKey);}},store=new FactoryContentStoreV4({sources:this.deployment.contentSources}),client=new ScientificClientV5({connection:v.adapter.connection,deployment:this.deployment,send:v.adapter.send,contentStore:store,wallet});
    const publish=async({round,claim,root,bytes})=>{
      if(!this.intent)throw new Error('Scientific mining paused');v.adapter.rpc.assertReady();const message=uploadMessage({genesis:this.deployment.genesisHash,program:this.deployment.programId,round,claim,root,bytes:bytes.size});
      const [signature]=await v.financial.wallet.features['solana:signMessage'].signMessage({account:v.financial.account,message});
      const response=await fetch(new URL('/api/science/v5/content/'+root+'.bin',this.deployment.apiBase),{method:'PUT',body:bytes,headers:{'X-Scientific-Round':round,'X-Scientific-Claim':claim,'X-Scientific-Signature':hex(signature.signature)},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error('Scientific evidence publication failed');await store.get(root,bytes.size);
    };
    const compute=async({task,round,reader})=>{const port=workerPort(reader,round.roundAddress),id=crypto.randomUUID(),g=round.content.goal,config={...v.store.config,steps:g.steps,time_step_us:g.timeStepUs,max_archive_bytes:g.maxTrialBytes};try{return await v.runtime.request('run',{task,round,config,factoryReadPort:port.port,networkId:this.deployment.genesisHash,sessionId:'science-v5:'+v.walletSetup.vault.address,operationId:id,executionId:id,observe:false},'result',[port.port]);}finally{port.close();}};
    const [role,assignment]=this.role.value.split(':').map(Number);this.runner=new ScientificMiningRunnerV5({client,compute,publish,onState:s=>{this.latest=s;this.status.textContent=labels[s.phase]?.[chinese()?0:1]||s.phase;this.root.dataset.phase=s.phase;if(s.claim)this.status.textContent+=' · '+s.claim.slice(0,12);}});
    this.client=client;
    try{for(const address of this.deployment.rounds){if(!this.intent)break;const r=await client.reader.round(address);if(r.closed)continue;const content=await client.reader.content(r,store),g=content.goal,c=v.store.config;if(g.graphRoot!==c.graph_sha256||g.modelDataRoot!==c.model_sha256||g.modelRoot!==c.model_root_sha256||g.registryRoot!==c.registry_sha256||g.neuronCount!==c.neuron_count)throw new Error('Prepare the registered complete model before committing scientific work');const saved=await this.runner.run(address,{role,assignment,waitForPayment:false});if(saved){this.saved=saved;this.download.disabled=false;await this.refreshEntitlements();}}
      if(this.intent)this.status.textContent=say('已登记的轮次已结束，等待新的已资助轮次。','Published rounds have ended; waiting for a new funded round.');
    }finally{this.running=false;this.intent=false;v.walletSetup.vault.policy=base;Object.assign(v.runtime,previous);v.render();}
  }
  async refreshEntitlements(){
    if(!this.client||this.refreshing||!this.view.adapter.rpc.ready)return;this.refreshing=true;
    try{const rows=(await new ScientificJournalV5().list()).filter(r=>r.wallet===String(this.client.wallet.publicKey)&&r.key.startsWith(this.deployment.genesisHash+':'+this.deployment.programId+':'));this.receipts.replaceChildren();
      for(const row of rows.slice(-32)){const c=await this.client.reader.claim(row.claim,row.round),line=make('li');line.textContent=row.claim.slice(0,12)+' · '+(c.state===5?say('已到账','Paid'):c.state===2?say('已接受，待到账','Accepted, unpaid'):c.state===4?say('重复贡献','Duplicate contribution'):c.state===3?say('未获奖励资格','Not qualified'):say('等待核验','Awaiting verification'));
        if(row.manifestRoot){const link=make('a',say(' 查看证据',' Inspect evidence'));link.href=new URL('/api/science/v5/content/'+row.manifestRoot+'.bin',this.deployment.apiBase);link.target='_blank';link.rel='noopener';line.append(link);}this.receipts.append(line);}
    }finally{this.refreshing=false;}
  }
  async export(){if(!this.saved)return;const {salt,archives,...record}=this.saved;const bytes=JSON.stringify({...record,scope:'computational-model study; operator independence and biological validity are not established'},null,2),url=URL.createObjectURL(new Blob([bytes],{type:'application/json'})),a=make('a');a.href=url;a.download='flybrainwork-scientific-evidence.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
export async function attachScientificMining(view){
  try{const response=await fetch('/assets/data/scientific-deployment-v5.json',{cache:'no-store'});if(!response.ok)return null;const d=await response.json();if(d.schema!=='flybrain-scientific-deployment-v5')return null;
    if(d.enabled&&(['programId','genesisHash','policyHash','mint'].some(k=>d[k]!==view.factoryDeployment[k])||new URL(d.apiBase).origin!==new URL(view.factoryDeployment.apiBase).origin))throw new Error('Scientific deployment differs from the registered network');
    return new ScientificMiningPanelV5(view,d);
  }catch{return null;}
}
