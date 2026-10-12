// Exactly campaign-core::QueueEntry::blocks. Deadline comparisons are inclusive.
export function queueBlocks(entry,now){
  const nonempty=entry.submission?.some(x=>x!==0);
  return !!nonempty&&((entry.status===0&&BigInt(now)<=BigInt(entry.revealDeadline))
    ||(entry.status===1&&BigInt(now)<=BigInt(entry.verifyDeadline))||entry.status===2);
}
export const catalogTaskCount=c=>c.campaign.targets.length*c.campaign.stimuli.length*c.campaign.repeats;
export function taskAvailability(catalog,k,{local=[],pending=[],snapshot=null,rules=null,compatible=()=>true,allowRecompute=false}={}){
  if(!Number.isSafeInteger(k)||k<0||k>=catalogTaskCount(catalog))return {eligible:false,reason:'catalog'};
  if(!compatible(k))return {eligible:false,reason:'resource'};
  if(pending.some(p=>Number(p.k??p.global_task_index)===k&& !['accepted','lost','rejected','timeout','closed'].includes(p.phase)))return {eligible:false,reason:'pending'};
  if(!allowRecompute&&local.some(r=>Number(r.global_task_index)===k))return {eligible:false,reason:'local'};
  if(!snapshot)return {eligible:true,occupied:0};
  if(snapshot.state.state!==1||(rules&&BigInt(snapshot.clock.unixTimestamp)>BigInt(rules.submit_deadline)))return {eligible:false,reason:'activity-ended'};
  const page=snapshot.pages.find(p=>Number(p.k)===k);
  if(!page)return {eligible:false,reason:'missing-page'};
  if(page.complete)return {eligible:false,reason:'completed'};
  const occupied=page.queue.filter(q=>queueBlocks(q,snapshot.clock.unixTimestamp)).length;
  return {eligible:occupied<page.queue.length,occupied,reason:occupied<page.queue.length?null:'queue-full'};
}
export function eligibleIndices(catalog,options={}){
  const indices=[];
  for(let k=0;k<catalogTaskCount(catalog);k++){const a=taskAvailability(catalog,k,options);if(a.eligible)indices.push({k,occupied:a.occupied});}
  // Randomization is supplied by the caller and can only break selection ties.
  // It never changes a stimulus, public seed, TaskID, response or reward.
  const random=options.random;
  if(random)for(let i=indices.length-1;i>0;i--){const j=Math.min(i,Math.max(0,Math.floor(random()*(i+1))));[indices[i],indices[j]]=[indices[j],indices[i]];}
  indices.sort((a,b)=>a.occupied-b.occupied);
  if(options.preferred!=null){const i=indices.findIndex(x=>x.k===options.preferred);if(i>=0)indices.unshift(...indices.splice(i,1));}
  return indices.map(x=>x.k);
}
