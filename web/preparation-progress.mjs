// Progress is data. Labels are diagnostics and never drive the state machine.
export const PREPARATION_SCHEMA='flypow-preparation-v2';
export const PREPARATION_STAGES=['inspect','inputs','verify','construct','load','ready'];
export const PREPARATION_PHASE={inspect:'checking',inputs:'fetching',verify:'checking-files',construct:'building',load:'loading',ready:'ready'};
export function preparationEvent(operationId,stageId,done=0,total=null,detail={}){
  const status=detail.status??(total!=null&&done===total?'completed':'active');
  if(!operationId||!PREPARATION_STAGES.includes(stageId)||!['active','completed','skipped','repairing','failed'].includes(status)
    ||!Number.isSafeInteger(done)||done<0||(total!=null&&(!Number.isSafeInteger(total)||total<done)))throw new Error('Invalid preparation event');
  return {schema:PREPARATION_SCHEMA,operationId,stageId,sourceId:null,status,done,total,unit:'bytes',elapsedMs:0,retryCount:0,...detail};
}
export function reducePreparationProgress(previous,event,operationId){
  if(event.schema!==PREPARATION_SCHEMA||event.operationId!==operationId)return previous;
  const parents={...previous.parents},sources={...previous.sources};
  if(event.sourceId){const old=sources[event.sourceId]||{stages:{}};sources[event.sourceId]={...old,...event,stages:{...old.stages,[event.substage||event.stageId]:event}};}
  // Per-file completion is distinct from completion of the parent phase.
  parents[event.stageId]={...event,status:event.sourceId&&event.status==='completed'?'active':event.status};
  return {parents,sources,current:event};
}
