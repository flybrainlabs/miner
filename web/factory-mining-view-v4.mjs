import {GoalMiningView} from './goal-mining-view.mjs';
import {deriveGoalUiState} from './goal-ui-state.mjs';
import {retainedCandidateOutputs} from './pending-output.mjs';
import {say,label,short,texts} from './goal-status-text.mjs';
import {setMiningButtonLabel} from './mining-presentation.mjs';
import {miningWorkflow,showMiningStage,MINING_STEPS} from './mining-workflow.mjs';
import {MinerRpcSettingsV4} from './miner-rpc-settings-v4.mjs';
import {MinerWalletSetupV4} from './miner-wallet-setup-v4.mjs';
import {FactoryMiningClientV4,FactorySubmissionV4,factoryWalletAdapter} from '/assets/vendor/generated/factory-wallet-v4.mjs';
const $=id=>document.getElementById(id);
const atoms=n=>{const v=BigInt(n||0);return (v/100000000n).toString()+((v%100000000n)?'.'+(v%100000000n).toString().padStart(8,'0').replace(/0+$/,''):'');};
Object.assign(texts,{'rpc-required':['请先设置 RPC','Set up your RPC first'],'configure-rpc':['设置 RPC','Set up RPC'],'checking-rpc':['正在验证 RPC…','Verifying RPC…'],'preparation-required':['请先准备本机模型','Prepare the model on this device'],'prepare-model':['构建模型','Build model'],'contract-task-expired':['本轮已超时 · 可按合约规则接续','Task expired · contract recovery available'],'contract-result-ready':['已有通过验证的候选 · 可完成结算','Verified candidate ready · finalize the result'],'contract-task-ready':['下一项预设任务待开启','Next predefined task ready to open'],'recover-contract-task':['接续合约任务','Continue contract task'],'finalize-contract-result':['完成候选结算','Finalize verified result'],'contract-empty-window':['新承诺已截止 · 本轮暂无候选','Claims closed · no candidates this attempt']});
export class FactoryMiningViewV4 extends GoalMiningView {
  constructor({factory,financial,...options}){
    if(!financial?.availableWallets)throw new Error('The shared wallet connection is unavailable');
    const adapter=factoryWalletAdapter({deployment:factory,session:financial}),network={...options.network,...factory,protocolVersion:4,networkId:factory.genesisHash,campaignId:factory.factory,authorityId:factory.policyHash};
    const bindings={client:callbacks=>new FactoryMiningClientV4({deployment:factory,...adapter,...callbacks}),submission:(client,store,onChange)=>new FactorySubmissionV4(client,store,onChange)};
    super({...options,network,financial,bindings});this.factoryDeployment=factory;this.adapter=adapter;financial.miningBalanceReader=adapter.readBalances;this.client.assertMiningAuthorization=adapter.assertMiningAuthorization;this.taskHistory=[];this.submissionRetryAt=new Map();
    this.rpcStep=document.createElement('button');this.rpcStep.id='miner-step-rpc';this.rpcStep.type='button';this.rpcStep.setAttribute('role','tab');this.rpcStep.setAttribute('aria-controls','miner-rpc-settings');this.rpcStep.dataset.noI18n='';
    const number=document.createElement('span');number.className='miner-step-number';number.textContent='1';this.rpcStepLabel=document.createElement('span');this.rpcStep.append(number,this.rpcStepLabel);document.querySelector('.miner-step-tabs').prepend(this.rpcStep);this.rpcStep.onclick=()=>this.rpcSettings.focus();
    for(const [index,step]of MINING_STEPS.entries())$('miner-step-'+step).querySelector('.miner-step-number').textContent=String(index+2);
    this.rpcSettings=new MinerRpcSettingsV4({rpc:adapter.rpc,parent:document.querySelector('.miner-primary-panel .miner-main-actions'),onStateChange:()=>this.rpcStateChanged(),onChange:()=>this.connectRpc()});
    this.walletSetup=new MinerWalletSetupV4({deployment:factory,financial,adapter,parent:document.querySelector('.miner-step-tabs'),onChange:()=>this.walletStateChanged(),onNeedRpc:()=>this.rpcSettings.focus(),onLock:()=>this.runner.pauseNow('MINING_WALLET_LOCKED')});
    this.client.assertMiningAuthorization=()=>{adapter.assertMiningAuthorization();if(!this.walletSetup.ready)throw Object.assign(new Error('MINING_WALLET_APPROVAL'),{code:'MINING_WALLET_APPROVAL'});this.walletSetup.policy.assertCanMine();};
    this.factoryWalletChanged=()=>{const prior=this.client.identity?.publicKey;this.client.bindWallet();if(this.runner.running&&(prior!==this.client.identity?.publicKey||!adapter.isSignedIn()))this.runner.pauseNow(prior!==this.client.identity?.publicKey?'wallet-changed':'wallet-login-required');this.render();this.onChange?.();};financial.addEventListener('change',this.factoryWalletChanged);
    $('miner-target-sync').onclick=()=>{if(!adapter.rpc.ready)return this.rpcSettings.focus();return this.client.sync().then(()=>this.refresh(true)).catch(this.onError);};
    $('miner-round-history-next').hidden=true;
  }
  rpcStateChanged(){
    if(!this.adapter.rpc.ready&&this.rpcGeneration!==this.adapter.rpc.generation){
      this.rpcGeneration=this.adapter.rpc.generation;if(this.runner.running)this.runner.pauseNow('rpc-required');this.walletSetup?.policy?.revoke();this.snapshot=null;this.financial.factoryRentQuote=null;
      this.client.suspend(Object.assign(new Error('RPC_REQUIRED'),{code:'RPC_REQUIRED'})).catch(()=>{});
    }
    this.render();this.onChange?.();
  }
  walletStateChanged(){if(this.runner.running&&(!this.walletSetup.vault.unlocked||this.walletSetup.policy?.blocked||!this.walletSetup.policy?.approved))this.runner.pauseNow(this.walletSetup.policy?.blocked||'MINING_WALLET_LOCKED');this.render();this.onChange?.();}
  async connectRpc(){
    if(!this.adapter.rpc.ready){this.rpcStateChanged();await this.refresh();return;}
    await this.client.syncing?.catch(()=>{});
    try{await this.client.initialize();this.financial.factoryRentQuote=String(await this.client.reader.connection.getMinimumBalanceForRentExemption(768,'finalized'));try{await this.walletSetup.connected();}catch(error){this.walletSetup.failed(error);}if(this.adapter.isSignedIn())await this.financial.refresh().catch(()=>{});await this.refresh(true);this.rpcSettings.root.open=false;}
    catch(error){this.client.disconnected(error);if(this.adapter.rpc.ready)this.client.startPolling();throw error;}
  }
  async initialize(){await this.walletSetup.initialize();this.client.bindWallet();await this.adapter.rpc.initialize();await this.refresh();if(this.adapter.rpc.ready)try{await this.connectRpc();}catch{}this.recoveryTimer=setInterval(()=>{if(!document.hidden)this.refresh(this.adapter.rpc.ready).catch(()=>{});},5000);this.render();}
  async refresh(reconcile=false){
    if(this.refreshing)return;this.refreshing=true;
    try{
      this.rows=await this.store.list();this.pending=await retainedCandidateOutputs(this.network,this.store);const outputs=new Map(this.pending.map(x=>[x.task.trialId,x]));for(const r of this.runner.pendingResults.values())outputs.set(r.task.trialId,r);this.pending=[...outputs.values()];
      if(reconcile&&this.client.online){
        for(const m of this.rows){
          if(m.factoryV4?.submission&&(!m.terminalCompetition||m.won&&!m.rewardPaid))try{await this.submission.reconcile(m);}catch(error){m.submissionError||=error.message;}
          const retryable=['candidate-saved-passing-awaiting-submit','submitting-commitment','committed','uploading','revealing'].includes(m.phase),claimOpen=this.client.serverNow<Number(m.round.pre.claimDeadline),committed=['committed','uploading','revealing'].includes(m.phase);
          if(m.sciencePassed&&!m.terminalCompetition&&retryable&&(claimOpen||committed)&&this.walletSetup.ready&&(!m.factoryV4||m.factoryV4.miner===this.client.identity?.publicKey)&&Date.now()-(this.submissionRetryAt.get(m.candidateId)||0)>=15000){this.submissionRetryAt.set(m.candidateId,Date.now());this.submission.submit(m.candidateId).catch(async error=>{const latest=await this.store.metadata(m.candidateId);latest.submissionError=error.message;await this.store.update(latest);this.runner.pauseNow(error.code||'submission-error');});}
        }
        if(Date.now()-(this.historyAt||0)>15000||this.historyNext!==this.client.factory?.nextIndex){const previous=this.taskHistory||[],next=[],f=this.client.factory;for(let i=0;i<(f?.uploaded||0);i++){const saved=previous.find(t=>t.index===i);try{next.push(saved&&(saved.paid||saved.state===0&&i>=f.nextIndex)?saved:await this.client.reader.task(i));}catch{if(saved)next.push(saved);}}this.taskHistory=next;this.historyAt=Date.now();this.historyNext=f?.nextIndex;}
      }
      this.renderResults();this.render();
    }finally{this.refreshing=false;}
  }
  ui(){
    const p=this.state.value.preparation,f=this.snapshot?.factory,walletSignedIn=!!this.adapter?.isSignedIn();
    const ui=deriveGoalUiState({network:this.network,online:this.client.online&&!!this.client.identity,snapshot:this.snapshot,serverNow:this.client.serverNow,preparation:p.phase,modelReady:this.runtime.ready,preparing:this.preparing,running:this.runner.running,paused:this.runner.paused,reason:this.runner.pauseReason,actionBusy:this.actionBusy||this.recovering,pendingOutputs:this.pending.length,walletRequired:true,walletConnected:!!this.financial.account,walletSignedIn,walletRestoring:['restoring','connecting'].includes(this.financial.connectionState)});
    if(this.walletSetup&&!this.pending.length&&!this.preparing&&!(this.runner.running&&!this.runner.paused)&&(this.walletSetup.requiresUnlock||this.adapter.rpc.ready&&(!this.walletSetup.ready||this.runtime.ready&&!this.walletSetup.canMine)))return {state:'mining-wallet-required',button:'configure-mining-wallet',disabled:this.walletSetup.busy||!!this.actionBusy,action:'configure-mining-wallet',pendingOutputs:0};
    if(this.adapter&&!this.adapter.rpc.ready&&!this.pending.length&&!this.preparing&&!(this.runner.running&&!this.runner.paused))return {state:'rpc-required',button:this.adapter.rpc.busy?'checking-rpc':'configure-rpc',disabled:this.adapter.rpc.busy||!!this.actionBusy,action:'configure-rpc',pendingOutputs:0};
    const recovery=this.snapshot?.recovery;
    if(recovery&&this.adapter?.rpc.ready&&this.client.online&&walletSignedIn&&!this.preparing&&!this.pending.length&&(!this.runner.running||this.runner.paused)&&!['connect-wallet','sign-in','none','prepare'].includes(ui.action))return {state:recovery.kind==='expire'?'contract-task-expired':recovery.kind==='finalize'?'contract-result-ready':'contract-task-ready',button:'start-mining',disabled:!!this.actionBusy||!!this.recovering,action:'start',pendingOutputs:0};
    if(ui.state==='new-claims-closed'&&this.snapshot?.task?.queue.length===0)return {...ui,state:'contract-empty-window',button:'contract-empty-window'};
    if(!this.preparing&&!this.runner.running&&!this.pending.length&&!['connect-wallet','sign-in','none','prepare'].includes(ui.action)&&(f?.paused||[2,3].includes(f?.state)))return {state:f.paused?'contract-paused':'research-stage-complete',button:'check-new-tasks',disabled:!!this.actionBusy,action:'sync',pendingOutputs:0};
    return ui;
  }
  async recoverContractTask(){
    this.adapter.assertMiningAuthorization();if(this.recovering)return;this.recovering=true;this.render();
    try{await this.client.recoverTask();await this.refresh(true);}finally{this.recovering=false;this.render();}
  }
  async prepareMiningSession(){await this.walletSetup.ensureSession();this.client.assertMiningAuthorization();await this.client.sync();if(this.snapshot?.recovery)await this.recoverContractTask();}
  render(){
    if(!this.runner)return;showMiningStage(document,miningWorkflow(this.state.value.preparation,{ready:this.runtime.ready,running:this.runner.running,pendingOutputs:this.pending.length}));super.render();this.rpcSettings?.render();this.walletSetup?.render();const f=this.snapshot?.factory,t=this.snapshot?.task,r=this.snapshot?.round;this.financial.factorySnapshot=this.snapshot;$('miner-preparation').hidden=this.state.value.preparation.phase==='unsupported';
    if(this.ui().action==='configure-mining-wallet'){
      for(const step of MINING_STEPS){const tab=$('miner-step-'+step);tab.hidden=true;tab.disabled=true;tab.tabIndex=-1;tab.setAttribute('aria-selected','false');tab.setAttribute('aria-current','false');$('miner-stage-'+step).hidden=true;}
      this.rpcStep.hidden=true;$('miner-preparation').hidden=true;$('miner-preparation-progress').hidden=true;$('miner-live-progress').hidden=true;
      document.querySelector('.miner-primary-panel').dataset.stage='wallet';setMiningButtonLabel($('miner-primary'),say(this.walletSetup.vault.exists?'解锁 / 设置挖矿钱包':'创建专用挖矿钱包',this.walletSetup.vault.exists?'Unlock / set up mining wallet':'Create dedicated mining wallet'));$('miner-primary').disabled=this.ui().disabled;
      $('miner-status').textContent=say('先完成专用钱包、备份与本次支付额度','Set up your mining wallet, backup and session cap first');$('miner-guidance').hidden=false;$('miner-guidance').textContent=say('助记词在本机生成，SOL 转入你自己的钱包。自动支付仅限当前挖矿合约和你确认的额度。','The phrase is generated on your device and SOL is sent to your own wallet. Automatic payments are limited to this mining contract and your confirmed cap.');
      $('miner-step-note').hidden=false;$('miner-step-note').textContent=say('请在上方完成专用挖矿钱包设置。已有模型与计算记录会保留。','Complete the mining-wallet setup above. Your existing model and results are retained.');
    }
    if(this.rpcStep){const required=this.ui().action==='configure-rpc';this.rpcStep.hidden=!required;this.rpcStep.setAttribute('aria-selected',String(required));this.rpcStep.setAttribute('aria-current',required?'step':'false');this.rpcStep.tabIndex=required?0:-1;this.rpcStepLabel.textContent=say('设置 RPC','Set up RPC');}
    if(this.ui().action==='configure-rpc'){
      document.querySelector('.miner-primary-panel').dataset.stage='rpc';
      $('miner-preparation').hidden=true;
      for(const step of MINING_STEPS){const tab=$('miner-step-'+step);tab.hidden=true;tab.disabled=true;tab.tabIndex=-1;tab.setAttribute('aria-selected','false');tab.setAttribute('aria-current','false');$('miner-stage-'+step).hidden=true;}
      $('miner-preparation-progress').hidden=true;$('miner-live-progress').hidden=true;
      const ui=this.ui();setMiningButtonLabel($('miner-primary'),label(ui.button));$('miner-primary').disabled=ui.disabled;$('miner-status').textContent=label('rpc-required');$('miner-target-state').textContent=label('rpc-required');
      $('miner-guidance').hidden=false;$('miner-guidance').textContent=say('设置并验证自己的 Helius API Key 后，再连接钱包、准备模型和挖矿。网络自动选择。','Set and verify your Helius API key, then connect your wallet, prepare the model and mine. The network is selected automatically.');
      $('miner-step-note').hidden=false;$('miner-step-note').textContent=say('请先完成上方的 RPC 设置。','Complete the RPC setup above first.');
    }
    if(this.snapshot?.recovery&&this.ui().action==='start'){
      const ui=this.ui();$('miner-status').textContent=label(ui.state);$('miner-target-state').textContent=label(ui.state);$('miner-goal-progress').textContent=label(ui.state);setMiningButtonLabel($('miner-primary'),this.recovering?say('等待钱包确认或链上确认…','Waiting for wallet or chain confirmation…'):label(ui.button));$('miner-primary').disabled=ui.disabled;
      $('miner-guidance').hidden=false;$('miner-guidance').textContent=say('点击“开始挖矿”后，专用钱包会在已批准的额度内先接续合约任务，再开始计算，无需钱包插件反复确认。','Select Start mining. Your mining wallet first recovers the contract task within the approved cap, then begins computation without repeated extension prompts.');
      $('miner-step-note').hidden=false;$('miner-step-note').textContent=say('本机模型和计算记录会保留。接续完成后即可开始挖矿。','Your model and saved results are retained. Start mining after recovery completes.');
    }else if(this.ui().state==='contract-empty-window'){
      $('miner-status').textContent=label('contract-empty-window');$('miner-target-state').textContent=label('contract-empty-window');$('miner-goal-progress').textContent=label('contract-empty-window');
      $('miner-guidance').hidden=false;$('miner-guidance').textContent=say('本轮没有候选；验证期限结束后可按合约规则接续任务。','This attempt has no candidates. Contract recovery becomes available after its verification deadline.');
    }
    if($('wallet-mining-round-budget'))$('wallet-mining-round-budget').textContent=t?say('本任务获胜解奖励：','Reward for this task’s winning solution: ')+atoms(t.descriptor.rewardAtoms)+' FBW':say('等待合约开放下一个预设任务','Waiting for the contract to open the next predefined task');
    const own=this.rows.find(m=>m.roundId===r?.roundId&&m.factoryV4?.submission);
    if($('wallet-mining-round-status'))$('wallet-mining-round-status').textContent=own?.rewardPaid?say('获胜解已确认，奖励已到账','Winning solution confirmed; reward received'):own?.won?say('合约已确认获胜解，奖励结算中','Contract confirmed the winner; payment pending'):own?say(`节点完整重放 ${own.validVotes||0}/2`,`Complete node replay ${own.validVotes||0}/2`):say('由合约验收并自动开启下一任务','The contract accepts results and opens the successor');
    $('miner-mode').textContent=say('合约预设任务 · 节点完整验证','Contract-defined tasks · full node verification');
    $('miner-current-difficulty').textContent=r?'R'+r.pre.requiredBackgrounds:'—';
    $('miner-difficulty-state').textContent=say('规则和随机背景已预设并冻结；节点不生成或修改任务。','Rules and public backgrounds are frozen in advance; nodes do not generate or modify tasks.');
    if(r){const a=document.createElement('a');a.href='https://explorer.solana.com/address/'+r.pre.taskAddress+'?cluster=devnet';a.target='_blank';a.rel='noopener noreferrer';a.textContent=say(`合约任务 ${r.pre.taskIndex+1} · 链上记录`,`Contract task ${r.pre.taskIndex+1} · chain record`);$('miner-target-round').replaceChildren(a);}
    if(this.factoryDeployment&&f)$('miner-target-details').textContent=JSON.stringify({factory:this.factoryDeployment.factory,catalogRoot:this.factoryDeployment.catalogRoot,taskIndex:t?.index,attempt:t?.attempt,rewardFBW:t?atoms(t.descriptor.rewardAtoms):null,requiredBackgrounds:r?.pre.requiredBackgrounds,windows:r?.goal.windows,deadlines:r?{commit:r.pre.claimDeadline,reveal:r.pre.revealDeadline,verification:r.pre.verificationDeadline}:null,source:'finalized Solana task accounts',frozenVerifierQuorum:'2 of 3 trusted keys; currently one operator'},null,2);
    this.renderCompetition();
  }
  renderCompetition(){
    const f=this.snapshot?.factory;if(!$('miner-competition-events'))return;
    $('miner-network-rate').textContent='—';$('miner-network-rate-note').textContent=say('奖励根据合约确认的完整解发放。','Rewards follow complete solutions accepted by the contract.');
    $('miner-network-statistics').textContent=f?say(`预设任务 ${f.count} · 已开启 ${f.nextIndex} · 当前 ${f.activeIndex===0xffffffff?'—':f.activeIndex+1}`,`Predefined tasks ${f.count} · opened ${f.nextIndex} · current ${f.activeIndex===0xffffffff?'—':f.activeIndex+1}`):this.adapter?.rpc.ready?say('读取链上任务状态','Reading chain task state'):say('请先完成 RPC 设置','Complete RPC setup first');
    $('miner-supply-state').textContent=f?say(`冻结总预算 ${atoms(f.budget)} FBW · 当前预留 ${atoms(f.reserved)} · 待支付 ${atoms(f.acceptedUnpaid)} · 已支付 ${atoms(f.paid)}`,`Frozen budget ${atoms(f.budget)} FBW · reserved ${atoms(f.reserved)} · unpaid ${atoms(f.acceptedUnpaid)} · paid ${atoms(f.paid)}`):'';
    $('miner-round-outcome').textContent=say('节点完整重放；合约检查 2/3 可信密钥后确认并推进。','Nodes fully replay; the contract confirms a 2/3 trusted quorum and advances.');
    $('miner-network-stats-detail').textContent=f?JSON.stringify(f,(_,v)=>typeof v==='bigint'?String(v):v instanceof Uint8Array?[...v]:v,2):'{}';$('miner-competition-events').replaceChildren();
    $('miner-own-candidates').textContent=this.rows.slice(0,5).map(m=>`${say('任务','Task')} ${m.round.pre.taskIndex+1} · ${short(m.candidateId)} · ${label(m.phase)} · ${m.validVotes||0}/2`).join('\n')||say('尚无提交','No submissions');$('miner-submit-stage').textContent=this.rows[0]?label(this.rows[0].phase):say('暂无提交','No submission');
    $('miner-round-history').replaceChildren(...(this.taskHistory||[]).map(t=>{const p=document.createElement('p');p.textContent=say(`任务 ${t.index+1} · ${['预设','开放','已完成','失败'][t.state]||'—'} · ${atoms(t.descriptor.rewardAtoms)} FBW${t.paid?' · 已到账':''}`,`Task ${t.index+1} · ${['scheduled','open','solved','failed'][t.state]||'—'} · ${atoms(t.descriptor.rewardAtoms)} FBW${t.paid?' · paid':''}`);return p;}));$('miner-round-history-next').disabled=true;
  }
  renderResults(){super.renderResults();const host=$('miner-goal-result-list');if(!host)return;for(const m of this.rows.filter(x=>x.factoryV4&&x.sciencePassed&&!x.rewardPaid).slice(0,8)){const b=document.createElement('button');b.type='button';b.className='button button-ghost';b.textContent=m.won?say('领取已确认奖励','Claim confirmed reward'):m.phase==='valid'?say('完成合约裁决','Finalize verified solution'):say('核对 / 恢复原提交','Reconcile / resume original submission');b.onclick=async()=>{b.disabled=true;try{this.adapter.assertMiningAuthorization();if(m.won)await this.submission.pay(m);else if(m.phase==='valid')await this.submission.finalize(m);else{await this.submission.reconcile(m);if(!m.terminalCompetition)await this.submission.submit(m.candidateId);}await this.refresh(true);}catch(error){this.onError(error);}finally{b.disabled=false;}};host.append(b);}}
  dispose(){this.walletSetup?.dispose();this.rpcSettings?.dispose();this.rpcStep?.remove();this.financial.removeEventListener('change',this.factoryWalletChanged);super.dispose();}
}
