import {say,short} from './goal-status-text.mjs';

// Saved model trials, scientific qualification, chain votes and payment are
// separate facts. A chain vote count is never a model-computation counter.
export function candidateProgressV4(m){
 const saved=m.trials?.length||0,required=m.round?.pre?.requiredBackgrounds||0;
 const complete=m.searchComplete===true||saved>=required&&required>0;
 const computing=!complete&&['computing','partial-trial-interrupted'].includes(m.phase);
 const computation=computing?say(`正在计算，已保存 ${saved}/${required} 组完整计算`,`Computing; ${saved}/${required} complete runs saved`):complete?say(`本次计算已结束，已保存 ${saved} 组完整计算`,`Attempt finished; ${saved} complete runs saved`):say(`已保存 ${saved}/${required} 组完整计算`,`Saved ${saved}/${required} complete runs`);
 if(m.rewardPaid===true)return {title:say('奖励已到账','Reward received'),detail:say('计算与验证已通过 · 获胜奖励已在链上确认到账','Computation and verification passed · winning reward confirmed on chain')};
 if(m.won===true)return {title:say('已获胜，正在发放奖励','Winner confirmed; reward payment pending'),detail:computation+say(' · 验证已通过 · 等待奖励到账',' · verification passed · waiting for payment')};
 if(m.phase==='candidate-failed-science'||m.sciencePassed===false&&complete)return {title:say('本次未达到任务要求','This attempt did not meet the task requirements'),detail:computation+say(' · 未提交节点验证 · 本次无奖励',' · not submitted for node verification · no reward for this attempt')};
 if(m.phase==='invalid')return {title:say('节点复算未通过','Node recomputation did not pass'),detail:computation+say(' · 验证未通过 · 本次无奖励',' · verification failed · no reward for this attempt')};
 if(m.phase==='timed_out'||m.phase==='claim-not-recorded')return {title:say('本次提交已超时，结果已保留','Submission timed out; saved results retained'),detail:computation+say(' · 未确认奖励',' · reward not confirmed')};
 if(m.phase==='saved-not-selected'||m.terminalCompetition)return {title:say('本次未获胜，结果已保留','This attempt did not win; results retained'),detail:computation+say(' · 本次无获胜奖励',' · no winning reward for this attempt')};
 if(computing||!m.sciencePassed&&!m.factoryV4?.submission)return {title:computing?say('正在计算任务','Computing the task'):say('计算记录已保存','Computation saved'),detail:computation+say(' · 尚未提交验证',' · not yet submitted for verification')};
 const votes=Number.isInteger(m.validVotes)?m.validVotes:0;
 if(['verifying','valid'].includes(m.phase))return {title:m.phase==='valid'?say('验证已通过，等待确认获胜结果','Verification passed; waiting for winner confirmation'):say('计算已完成，节点正在复算','Computation finished; nodes are recomputing'),detail:computation+say(' · 本机检查达标 · ',' · local requirements met · ')+(m.phase==='valid'?say('链上验证已通过','chain verification passed'):say(`链上验证确认 ${votes}/2 份`,`Chain verification confirmations: ${votes}/2`))+say(' · 奖励尚未到账',' · reward not received yet')};
 const uploading=['committed','uploading','revealing'].includes(m.phase);
 return {title:uploading?say('已达到任务要求，正在上传提交','Task requirements met; uploading submission'):say('已达到任务要求，等待提交','Task requirements met; waiting to submit'),detail:computation+say(' · 本机检查达标 · 节点验证尚未完成 · 奖励尚未到账',' · local requirements met · node verification pending · reward not received yet')};
}

export function candidateLineV4(m){const p=candidateProgressV4(m);return `${say('任务','Task')} ${(m.round?.pre?.taskIndex??0)+1} · ${short(m.candidateId)} · ${p.title}\n${p.detail}`;}

export function visibleTaskHistoryV4(tasks){return (tasks||[]).filter(t=>t.state!==0).sort((a,b)=>b.index-a.index);}
export function taskHistoryLineV4(t,reward){
 const state=t.state===1?say('正在进行','In progress'):t.state===2?say('已完成','Completed'):t.state===3?say('已到期，本轮无合格结果','Expired without a qualifying result'):say('正在核对状态','Checking status');
 const payment=t.paid?say('奖励已在链上支付','Reward paid on chain'):t.state===2?say('等待奖励支付','Reward payment pending'):t.state===3?say('本轮未发放奖励','No reward paid this round'):say('奖励待本轮结果确认','Reward awaits the round result');
 return `${say('任务','Task')} ${t.index+1} · ${state} · ${say('获胜奖励','Winning reward')} ${reward} FBW · ${payment}`;
}

export function renderTaskCompetitionV4(view){
 const $=id=>document.getElementById(id),f=view.snapshot?.factory;
 if(!$('miner-competition-events'))return;
 const caption=document.querySelector('#miner-computation .metric-caption');
 if(caption){caption.dataset.noI18n='';caption.textContent=say('本机实际计算速度','Measured compute speed on this device');}
 $('miner-network-rate').textContent='—';
 $('miner-network-rate-note').textContent=say('按实际完整模型计算统计；奖励以通过验证的获胜结果为准。','Measured from actual complete-model computation; rewards follow verified winning results.');
 $('miner-network-statistics').textContent=f?say(`本目录已开启 ${f.nextIndex} 项任务 · 当前任务 ${f.activeIndex===0xffffffff?'—':f.activeIndex+1}`,`Tasks opened in this catalog: ${f.nextIndex} · current task: ${f.activeIndex===0xffffffff?'—':f.activeIndex+1}`):view.adapter?.rpc.ready?say('正在读取任务状态','Reading task state'):say('请先完成 RPC 设置','Complete RPC setup first');
 const atoms=n=>{const v=BigInt(n||0);return (v/100000000n).toString()+((v%100000000n)?'.'+(v%100000000n).toString().padStart(8,'0').replace(/0+$/,''):'');};
 $('miner-supply-state').textContent=f?say(`本目录奖励预算 ${atoms(f.budget)} FBW · 当前任务预留 ${atoms(f.reserved)} · 待支付 ${atoms(f.acceptedUnpaid)} · 已支付 ${atoms(f.paid)}`,`Catalog reward budget ${atoms(f.budget)} FBW · reserved ${atoms(f.reserved)} · payment pending ${atoms(f.acceptedUnpaid)} · paid ${atoms(f.paid)}`):'';
 $('miner-round-outcome').textContent=say('每轮验证队列最多容纳 8 份候选，最多 1 个获胜结果。验证和奖励支付在后台处理，有可用任务时自动接续计算。','Each round holds up to 8 queued candidates and at most 1 winner. Verification and payment run in the background; computation continues when a task is available.');
 $('miner-network-stats-detail').textContent=f?JSON.stringify(f,(_,v)=>typeof v==='bigint'?String(v):v instanceof Uint8Array?[...v]:v,2):'{}';
 $('miner-competition-events').replaceChildren();
 $('miner-own-candidates').textContent=(view.rows||[]).slice(0,5).map(candidateLineV4).join('\n\n')||say('尚无计算记录','No computation records yet');
 $('miner-submit-stage').textContent=view.rows?.[0]?candidateProgressV4(view.rows[0]).title:say('暂无提交','No submission');
 const tasks=visibleTaskHistoryV4(view.taskHistory);
 const rows=tasks.map(t=>{const p=document.createElement('p');p.textContent=taskHistoryLineV4(t,atoms(t.descriptor.rewardAtoms));return p;});
 if(!rows.length){const p=document.createElement('p');p.textContent=say('尚无已开启的任务；任务按需求自动准备并开放。','No task has opened yet; tasks are prepared and opened automatically as needed.');rows.push(p);}
 $('miner-round-history').replaceChildren(...rows);$('miner-round-history-next').disabled=true;
}

export function renderContinuousWaitV4(view){
 const r=view.runner;if(!r.running||!r.intent||!r.paused||!r.capacityWait&&!r.retryWait)return;
 const reason=r.capacityWait||r.retryWait,$=id=>document.getElementById(id);
 const fees=reason==='MINING_WALLET_BALANCE',space=['browser-space','storage-limit','outbox-capacity'].includes(reason);
 const title=fees?say('SOL 不足，等待充值','Insufficient SOL; waiting for a top-up'):space?say('等待可用存储空间','Waiting for available storage'):say('正在自动重试，挖矿会话已保留','Retrying automatically; mining session retained');
 $('miner-status').textContent=title;$('miner-target-state').textContent=title;$('miner-goal-progress').textContent=title;
 $('miner-guidance').hidden=false;$('miner-guidance').textContent=fees?say('SOL 需覆盖下一笔网络手续费及必要的链上存储押金。充值后自动核验并继续；也可手动暂停。','SOL must cover the next network fee and any required on-chain storage deposit. A top-up is checked automatically before continuing; you can also pause.'):space?say('计算结果会保留。空间恢复后自动继续，不需要重新点击开始。','Saved computation is retained. Mining continues automatically when space is available, without another Start.'):say('任务、连接或计算恢复后会自动继续，无需重复点击开始。已保存的结果会保留。','Mining continues after task, connection or computation recovery without another Start. Saved results are retained.');
}

export async function recoverWaitingMiningV4(view){
 const r=view.runner;if(!r.running||!r.intent||!r.paused||view.recovering)return;
 if(view.pending.length&&Date.now()-(view.lastAutomaticSaveRetry||0)>15000){
  view.lastAutomaticSaveRetry=Date.now();await view.retryPendingOutputs().catch(()=>{});return;
 }
 if(view.pending.length||!view.walletSetup.canMine)return;
 const reason=r.capacityWait;
 if(reason){
  const estimate=await navigator.storage.estimate(),reservation=r.round?r.reservation:0;
  const space=estimate.quota!=null&&estimate.quota-estimate.usage>2*reservation;
  if(reason==='MINING_WALLET_BALANCE'||reason==='browser-space'&&space||reason==='outbox-capacity'&&view.outbox?.canAccept(reservation,r.budget.reservedBytes)||reason==='storage-limit'&&r.budget.savedBytes+r.budget.stagingBytes+r.budget.reservedBytes+reservation<=r.budget.storageBytes)r.resumeCapacity();
 }
 if(r.retryWait)r.retryWaiting();
}

// History reads run independently of candidate upload and contract recovery.
// Unopened inventory belongs to supply, rather than the round-history list.
export function refreshTaskHistoryV4(view){
 const client=view.client,f=client.factory;
 if(!f||!client.online||view.historyPending||Date.now()-(view.historyAt||0)<15000&&view.historyNext===f.nextIndex)return;
 const previous=new Map((view.taskHistory||[]).map(t=>[t.index,t]));
 view.historyPending=(async()=>{
  const next=[],end=Math.min(f.uploaded,f.nextIndex),start=Math.max(0,end-50);
  for(let i=start;i<end;i++){
   if(view.client!==client)return;
   const saved=previous.get(i);
   try{next.push(saved&&(saved.paid||saved.state===3)?saved:await client.reader.task(i));}catch{if(saved)next.push(saved);}
  }
  if(view.client!==client)return;
  view.taskHistory=next;view.historyAt=Date.now();view.historyNext=f.nextIndex;view.renderCompetition();
 })().finally(()=>view.historyPending=null);
 return view.historyPending;
}
