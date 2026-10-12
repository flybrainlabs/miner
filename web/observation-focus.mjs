// Both left-hand computation and right-hand live display use this barrier.
// No historical trace messages are replayed when changing the observed Worker.
export class ObservationFocus {
  constructor(owner){this.owner=owner;this.generation=0;this.enabled=true;this.current=null;}
  select(e){
    const o=this.owner;
    if(this.current===e&&e?.observationScope?.executionId===e.id)return;
    this.current?.slot.runtime.observe?.(this.current.observationScope,false);
    this.current=e||null;o.focusedExecutionId=e?.id||null;
    if(!e){o.onFocus?.(null);return;}
    const config=o.config,scope={networkId:e.round?.pre.networkId||'offline:'+config.campaign,sessionId:(o.budget||o.plan).sessionId,workerId:e.slot.id,operationId:e.operationId,executionId:e.id,roundId:e.task.roundId||null,goalId:e.task.goalId||null,candidateId:e.task.candidateId||null,trialId:e.task.trialId||null,configKey:[config.campaign,config.graph_sha256,config.model_sha256,config.task_catalog_sha256].join('/'),streamGeneration:++this.generation};
    e.observationScope=scope;o.onFocus?.(scope,e.task);e.slot.runtime.observe?.(scope,this.enabled);
  }
  setEnabled(enabled){this.enabled=!!enabled;this.current?.slot.runtime.observe?.(this.current.observationScope,this.enabled);}
  request(scope){if(this.current?.observationScope===scope||this.current?.observationScope?.streamGeneration===scope?.streamGeneration)this.current?.slot.runtime.observe?.(scope,this.enabled);}
  complete(e){if(this.current!==e)return;const next=this.owner.active.find(x=>x!==e&&x.task&&['running','resuming','parked','pausing','saving'].includes(x.slot.status));if(next){this.select(next);this.owner.onObservationStage?.(next.observationScope,next.slot.status==='parked'?'paused':next.slot.status==='saving'?'saving':'simulation');}else this.owner.onObservationStage?.(e.observationScope,e.cancelled?'stopped':'complete');}
}
