const $=id=>document.getElementById(id),t=(s,v={})=>window.FlyI18n.t(s,v);
export function responseRows(local,snapshot,sdk){
  const rows=new Map(local.map(r=>[r.task_id,{local:r,taskId:r.task_id,k:Number(r.global_task_index),body:String(r.body_id)}]));
  for(const p of snapshot?.pages||[])if(p.complete){const id=sdk.hex(p.taskId),ent=snapshot.entitlements.find(e=>sdk.hex(e.submission)===sdk.hex(p.winner));rows.set(id,{...rows.get(id),page:p,ent,taskId:id,k:Number(p.k),body:String(p.task.bodyId)});}
  return [...rows.values()].sort((a,b)=>a.k-b.k);
}
export function ownContributions(local,snapshot,pending,address,sdk){
  const rows=local.map(r=>({taskId:r.task_id,k:Number(r.global_task_index),body:r.body_id,local:r,status:'local'}));
  if(!snapshot||!address)return rows;
  for(const e of snapshot.entitlements.filter(e=>[e.miner,e.beneficiary,e.refundRecipient].some(x=>sdk.pk(x).toBase58()===address))){
    const id=sdk.hex(e.taskId),page=snapshot.pages.find(p=>sdk.hex(p.taskId)===id),winner=page?.complete&&sdk.hex(page.winner)===sdk.hex(e.submission),p=pending.find(p=>p.submission===sdk.pk(e.submission).toBase58());
    let status=winner?'accepted':page?.complete?'lost':e.closed?'expired':'verifying';if(p?.phase==='rejected')status='rejected';
    rows.push({taskId:id,k:Number(e.k),body:String(e.bodyId),ent:e,page,winner,pending:p,status});
  }
  for(const p of pending)if(!rows.some(r=>r.ent&&sdk.pk(r.ent.submission).toBase58()===p.submission))rows.push({taskId:p.taskId,k:p.k,body:p.bodyId,pending:p,status:p.phase||'processing'});
  return rows.sort((a,b)=>a.k-b.k);
}
export function entitlementFunds(ent,snapshot,address,sdk){
  const success=snapshot?.state.state===2,failed=snapshot?.state.state===3,beneficiary=ent&&sdk.pk(ent.beneficiary).toBase58()===address,refundRecipient=ent&&sdk.pk(ent.refundRecipient).toBase58()===address;
  const remaining=ent&&beneficiary&&ent.closed&&ent.accepted?ent.minerWhole*100000000n-ent.minerClaimed:0n;
  return {entitlement:beneficiary&&ent.closed&&ent.accepted?ent.minerWhole*100000000n:0n,claimed:beneficiary?ent?.minerClaimed||0n:0n,claimable:success&&snapshot.state.tge?remaining:0n,refundable:refundRecipient&&ent.closed&&!ent.refundPaid&&(!ent.accepted||success||failed)?(ent.accepted&&success?0n:ent.principal)+ent.advance:0n};
}
export class ContributionView {
  constructor({context,open,onSubmission}){this.context=context;this.open=open;this.onSubmission=onSubmission;this.page=0;$('miner-contribution-prev').onclick=()=>{this.page--;this.render();};$('miner-contribution-next').onclick=()=>{this.page++;this.render();};}
  render(){
    const {local,snapshot,pending=[],address,sdk}=this.context(),rows=ownContributions(local,snapshot,pending,address,sdk),counts={local:0,processing:0,verifying:0,accepted:0,ended:0};
    for(const r of rows){if(r.status==='local')counts.local++;else if(r.status==='accepted')counts.accepted++;else if(r.status==='verifying')counts.verifying++;else if(['lost','expired','rejected','timeout'].includes(r.status))counts.ended++;else counts.processing++;}
    const labels={local:'Local experiments',processing:'Submission in progress',verifying:'Awaiting verification',accepted:'Confirmed test contributions',ended:'Lost, rejected or expired'};
    $('miner-contribution-counts').replaceChildren(...Object.entries(counts).filter(([key])=>snapshot||key==='local').map(([key,n])=>{const el=document.createElement('div'),strong=document.createElement('strong'),label=document.createElement('span');strong.textContent=n.toLocaleString(window.FlyI18n.language);label.textContent=t(labels[key]);el.append(strong,label);return el;}));
    $('miner-contribution-mode').textContent=t(snapshot?'Test entitlements are checked on chain. Unissued entitlements are not tokens in your wallet.':'Research experience · no token rewards');
    this.page=Math.min(Math.max(0,this.page),Math.max(0,Math.ceil(rows.length/12)-1));const start=this.page*12;
    $('miner-contribution-note').textContent=rows.length?t('Results {first}–{last} of {total}',{first:start+1,last:Math.min(rows.length,start+12),total:rows.length}):t('No recorded results yet. Start an experience or explore the atlas.');
    const statusText={local:'Local unverified result',accepted:'Confirmed test contribution',verifying:'Awaiting verification',processing:'Submission in progress',lost:'Another candidate won',expired:'Expired',rejected:'Rejected',timeout:'Timed out',refundable:'Refund eligible','waiting-reveal':'Waiting for reveal slots','reveal-authorization':'Reveal needs your signature',unknown:'Transaction confirmation unknown',unsubmitted:'Submission not sent'};
    $('miner-contribution-list').replaceChildren(...rows.slice(start,start+12).map(r=>{
      const card=document.createElement('article');card.className='research-history-card';card.dataset.taskId=r.taskId;const h=document.createElement('h3');h.textContent=t('Cell {body} · task {task}',{body:r.body,task:r.k});const status=document.createElement('p');status.textContent=t(statusText[r.status]||'Submission in progress');card.append(h,status);
      if(r.local||r.winner&&r.page?.archived){const b=document.createElement('button');b.type='button';b.className='button button-ghost';b.textContent=t('View result and replay');b.onclick=()=>this.open(r);card.append(b);}
      if(r.pending){const b=document.createElement('button');b.type='button';b.className='button button-ghost';b.textContent=t('Review submission');b.onclick=()=>this.onSubmission(r.pending);card.append(b);}
      if(r.ent){const f=entitlementFunds(r.ent,snapshot,address,sdk),p=document.createElement('p');p.textContent=t('Test entitlement {entitlement} FBW · claimed {claimed} · claimable {claimable} · refundable {refund} SOL',{entitlement:formatAtoms(f.entitlement,8),claimed:formatAtoms(f.claimed,8),claimable:formatAtoms(f.claimable,8),refund:formatAtoms(f.refundable,9)});card.append(p);if(!r.pending){const b=document.createElement('button');b.type='button';b.className='button button-ghost';b.textContent=t('Review eligible funds');b.onclick=()=>this.onSubmission(null,r);card.append(b);}}
      return card;
    }));$('miner-contribution-prev').disabled=!this.page;$('miner-contribution-next').disabled=start+12>=rows.length;
  }
}
export function formatAtoms(value,decimals=9){const n=BigInt(value),unit=10n**BigInt(decimals),tail=(n%unit).toString().padStart(decimals,'0').replace(/0+$/,'');return(n/unit).toString()+(tail?'.'+tail:'');}
export function parseSOL(s){if(!/^\d+(\.\d{1,9})?$/.test(s))throw new Error('Use a nonnegative SOL amount with at most 9 decimals');const [a,b='']=s.split('.');return BigInt(a)*1000000000n+BigInt(b.padEnd(9,'0'));}
