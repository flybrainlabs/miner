import { compactNumber } from './metric-format.mjs';
// Local observations of real work. These values never enter scientific hashes,
// task identity, receipts, fees, or claims. No CPU/FLOPS/hash-rate is inferred.
const measured = (work, ms) => ms > 0 ? work * 1000 / ms : null;
const units = Object.freeze({neuron_updates:'one A or B neuron tick, including refractory ticks',synapse_transmissions:'one actual A or B synaptic addition',rates:'completed work / measured wall time; A and B combined',progress:'completed simulation steps only; excludes validation, response construction and saving'});
export class ComputationMeter {
  constructor(task, config, clock=()=>performance.now(), scope={}) {
    this.clock=clock;this.started=clock();this.simulationStarted=null;this.previous=null;
    this.pausedMs=0;this.pausedAt=null;
    this.identity={taskId:task.taskId,k:task.k,bodyId:String(task.bodyId),totalSteps:config.steps,neuronCount:config.neuron_count,directedConnections:config.directed_connection_count,timeStepUs:config.time_step_us};
    this.counters={completedSteps:0,neuronUpdates:0,synapseTransmissions:0,observedSpikesA:0,observedSpikesB:0};this.scope=scope;this.sequence=0;this.partialNeuronUpdates=0;this.workSynapseAdditions=0;
  }
  step(completedSteps,totalSteps,neuronUpdates,synapseTransmissions,observedSpikesA,observedSpikesB) {
    const now=this.clock(),numbers=[completedSteps,totalSteps,neuronUpdates,synapseTransmissions,observedSpikesA,observedSpikesB].map(Number);
    if(numbers.some(n=>!Number.isSafeInteger(n)||n<0)||totalSteps!==this.identity.totalSteps||completedSteps>totalSteps||numbers[2]!==2*this.identity.neuronCount*completedSteps||completedSteps<this.counters.completedSteps||numbers[3]<this.counters.synapseTransmissions)throw new Error('Invalid simulation work counters');
    if(this.simulationStarted===null){if(completedSteps!==0)throw new Error('Missing simulation start');this.simulationStarted=now;}
    const prior=this.previous;
    this.counters={completedSteps,totalSteps,neuronUpdates:numbers[2],synapseTransmissions:numbers[3],observedSpikesA:numbers[4],observedSpikesB:numbers[5]};this.partialNeuronUpdates=0;this.workSynapseAdditions=numbers[3];
    this.recent={recentNeuronUpdatesPerSecond:prior?measured(numbers[2]-prior.neuronUpdates,now-prior.at):null,recentSynapseTransmissionsPerSecond:prior?measured(numbers[3]-prior.synapseTransmissions,now-prior.at):null};
    this.previous={at:now,...this.counters};this.simulationMs=now-this.simulationStarted;
    return this.snapshot('simulation',now);
  }
  partial(neurons,synapses){const n=Number(neurons),s=Number(synapses);if(!Number.isSafeInteger(n)||n<0||n>2*this.identity.neuronCount||!Number.isSafeInteger(s)||s<this.counters.synapseTransmissions)throw new Error('Invalid partial work');this.partialNeuronUpdates=n;this.workSynapseAdditions=s;}
  pause(){if(this.pausedAt===null)this.pausedAt=this.clock();}
  resume(){if(this.pausedAt!==null){const ms=this.clock()-this.pausedAt;this.pausedMs+=ms;if(this.simulationStarted!==null)this.simulationStarted+=ms;if(this.previous)this.previous.at+=ms;this.pausedAt=null;}}
  snapshot(stage,now=this.clock()) {
    const c=this.counters,ms=this.simulationMs??0;
    const pausedMs=this.pausedMs+(this.pausedAt===null?0:now-this.pausedAt);
    return {schema:'flypow-computation-v3',type:'compute-progress',...this.identity,...c,...this.scope,sequence:++this.sequence,producedAt:Math.round(performance.timeOrigin+now),partialNeuronUpdates:this.partialNeuronUpdates,workNeuronUpdates:String(c.neuronUpdates+this.partialNeuronUpdates),workSynapseAdditions:String(this.workSynapseAdditions),stage,elapsedMs:now-this.started,activeElapsedMs:now-this.started-pausedMs,pausedMs,simulationMs:ms,modelTimeMs:c.completedSteps*this.identity.timeStepUs/1000,
      averageNeuronUpdatesPerSecond:measured(c.neuronUpdates,ms),averageSynapseTransmissionsPerSecond:measured(c.synapseTransmissions,ms),
      recentNeuronUpdatesPerSecond:stage==='simulation'?this.recent?.recentNeuronUpdatesPerSecond??null:null,recentSynapseTransmissionsPerSecond:stage==='simulation'?this.recent?.recentSynapseTransmissionsPerSecond??null:null,
      remainingSimulationMs:stage==='simulation'&&c.completedSteps>0&&c.completedSteps<c.totalSteps?ms/c.completedSteps*(c.totalSteps-c.completedSteps):null};
  }
}

export class ComputationLog {
  constructor(limit=200,clock=()=>performance.now()) {this.limit=limit;this.clock=clock;this.started=clock();this.rows=[];this.dropped=0;this.latest=null;}
  append(event,values={}) {
    const row={event,sessionElapsedMs:Math.max(0,this.clock()-this.started),...values};
    this.rows.push(row);if(this.rows.length>this.limit){const progress=this.rows.findIndex(r=>r.event==='progress');this.rows.splice(progress<0?0:progress,1);this.dropped++;}
    if(event==='task')this.latest=null;
    if(values.telemetry)this.latest=values.telemetry;
    return row;
  }
  summary(){return {schema:'flypow-computation-log-v1',scope:'local page session; timing is observational, not a proof or chain reward',units,retained:this.rows.length,dropped:this.dropped,latest:this.latest,entries:this.rows.map(r=>({...r}))};}
}

export const COMPUTATION_STAGES={validating:'Checking experiment inputs',simulation:'Simulating the complete network',paused:'Task paused in memory; continue explicitly',results:'Building the response archive',saving:'Saving the computed result',complete:'Experiment completed',stopped:'Stopped; this task must start again',error:'Computation needs attention'};
const seconds=ms=>Number.isFinite(ms)?(ms/1000).toFixed(1):'—';
export function computationLogText(report,t=s=>s,locale='en') {
  const count=n=>Number(n).toLocaleString(locale,{maximumFractionDigits:0});
  const lines=[t('Calculation log'),t('Local measurements; no wallet data or submission secrets.'),t('A/B combined. Throughput counts actual neuron updates and synaptic additions.'),t('Progress counts simulation steps. Remaining time estimates simulation only.'),t('Retained entries: {retained}; older entries omitted: {dropped}.',{retained:report.retained,dropped:report.dropped})];
  for(const row of report.entries){
    const m=row.telemetry,at=`[${seconds(row.sessionElapsedMs)} s] `;
    if(row.event==='task')lines.push(at+t('Task {task} · cell {body} · input {input} · repeat {repeat}',{task:row.k,body:row.bodyId,input:row.stimulusIndex,repeat:row.repeatIndex}),`TaskID ${row.taskId}`);
    else if(row.event==='progress'&&m){
      let text=t(COMPUTATION_STAGES[m.stage]||m.stage);
      if(m.stage==='simulation'){
        text+=' · '+t('Step {done}/{total} · neuron updates {neurons} · synaptic additions {synapses} · A/B spikes {a}/{b}',{done:m.completedSteps,total:m.totalSteps,neurons:count(m.neuronUpdates),synapses:count(m.synapseTransmissions),a:count(m.observedSpikesA),b:count(m.observedSpikesB)});
        if(Number.isFinite(m.recentNeuronUpdatesPerSecond))text+=' · '+t('{rate} {unit}',{rate:count(m.recentNeuronUpdatesPerSecond),unit:t('neuron updates/s')});
      }
      lines.push(at+(row.workerId?t('Task {task} · worker {worker}',{task:m.k,worker:row.workerId})+' · ':'')+text);
    }else if(row.event==='complete')lines.push(at+t('Completed in {seconds} s; result saved: {saved}.',{seconds:seconds(row.telemetry?.elapsedMs),saved:t(row.saved?'Yes':'No')}),`SHA-256 ${row.resultHash}`);
    else lines.push(at+t({'pause-requested':row.mode==='slice'?'Pause requested at the next safe slice.':'Pause requested; finishing this task first.',stopped:'Stopped; this task must start again',error:'Computation needs attention','save-error':'Calculation finished, but saving failed. Export the result before closing.'}[row.event]||row.event)+(row.code?' · '+row.code:''));
  }
  return lines.join('\n')+'\n';
}

export class ComputationView {
  constructor(log,{t=s=>s,locale=()=>document.documentElement.lang}={}) {
    this.log=log;this.t=t;this.locale=locale;this.last=null;this.lastReceived=0;this.active=false;
    this.$=id=>document.getElementById(id);
    this.$('miner-compute-export').onclick=()=>this.download();
    this.timer=setInterval(()=>{if(this.active&&this.last)this.elapsed();},250);
  }
  number(n){return Number(n).toLocaleString(this.locale(),{maximumFractionDigits:0});}
  rate(n,unit){return Number.isFinite(n)?this.t('{rate} {unit}',{rate:compactNumber(n,{locale:this.locale()}).text,unit:this.t(unit)}):this.t('Measuring');}
  elapsed(){this.$('miner-compute-elapsed').textContent=this.t('{seconds} s',{seconds:seconds(this.last.elapsedMs+(this.active?performance.now()-this.lastReceived:0))});}
  render(execution,active,visible=true) {
    const m=execution.telemetry,report=this.log.summary();this.$('miner-computation').hidden=!visible;
    this.active=!!active&&!!m&&!['complete','stopped','error','paused'].includes(m.stage);
    if(m!==this.last){this.last=m;this.lastReceived=performance.now();}
    this.$('miner-compute-neurons').dataset.unmeasured=String(!m);const bar=this.$('miner-compute-progress');bar.hidden=!m;this.$('miner-compute-stage').hidden=!m;
    if(m){
      this.$('miner-compute-stage').textContent=this.t(COMPUTATION_STAGES[m.stage]||m.stage);
      bar.max=m.totalSteps;bar.value=m.completedSteps;
      bar.setAttribute('aria-valuetext',this.t('{done} of {total} simulation steps',{done:m.completedSteps,total:m.totalSteps}));
      this.$('miner-compute-percent').textContent=(100*m.completedSteps/m.totalSteps).toLocaleString(this.locale(),{maximumFractionDigits:1})+'%';
      this.$('miner-compute-steps').textContent=this.t('{done} of {total} simulation steps',{done:m.completedSteps,total:m.totalSteps});
      const recent=active&&m.stage==='simulation';
      this.$('miner-compute-rate-label').textContent=this.t(recent?'Recent measured throughput':'Average simulation throughput');
      const aggregate=active?execution.aggregate:null;
      this.$('miner-compute-neurons').textContent=active?this.rate(aggregate?.neuronUpdatesPerSecond,'updates/s'):this.t('No active computation');
      this.$('miner-compute-synapses').textContent=active?this.rate(aggregate?.synapseAdditionsPerSecond,'additions/s'):this.t('Idle');
      this.$('miner-compute-neurons').title=aggregate?String(aggregate.neuronUpdatesPerSecond)+' updates/s; '+aggregate.scope: this.t('Current throughput has no running sample');
      this.$('miner-compute-synapses').title=aggregate?String(aggregate.synapseAdditionsPerSecond)+' additions/s; '+aggregate.scope:this.t('Current throughput has no running sample');
      this.$('miner-compute-rate-label').textContent=this.t('Current throughput: shared wall-clock window')+' · '+this.t('Historical average')+' '+this.rate(m.averageNeuronUpdatesPerSecond,'updates/s')+' / '+this.rate(m.averageSynapseTransmissionsPerSecond,'additions/s');
      this.$('miner-compute-model').textContent=this.t('{neurons} neurons · {edges} connections',{neurons:this.number(m.neuronCount),edges:this.number(m.directedConnections)});
      this.$('miner-compute-remaining').textContent=Number.isFinite(m.remainingSimulationMs)?this.t('About {seconds} s of simulation remaining',{seconds:seconds(m.remainingSimulationMs)}):'—';
      this.elapsed();
    }else{
      bar.value=0;this.$('miner-compute-percent').textContent='';this.$('miner-compute-stage').textContent=this.t(execution.phase==='error'?'Computation needs attention':execution.phase==='paused'?'Stopped; this task must start again':'Checking experiment inputs');
      for(const id of ['steps','elapsed','remaining','model'])this.$('miner-compute-'+id).textContent='';this.$('miner-compute-neurons').textContent=this.t(active?'Measuring':'Awaiting computation');this.$('miner-compute-synapses').textContent='';
    }
    // Primary rate describes the entire pool, including zero work while saving
    // or waiting. It must not depend on the focused worker having a packet.
    const aggregate=execution.aggregate;
    const measured=!!active&&Number.isFinite(aggregate?.neuronUpdatesPerSecond);
    this.$('miner-compute-neurons').textContent=!active?this.t(execution.phase==='paused'?'Mining paused':'Not running'):measured?compactNumber(aggregate.neuronUpdatesPerSecond,{locale:this.locale()}).text:this.t('Measuring');
    const unit=document.querySelector('#miner-computation .metric-unit');if(unit)unit.hidden=!measured;
    this.$('miner-compute-neurons').dataset.unmeasured=String(!measured);
    if(aggregate){
      this.$('miner-compute-synapses').textContent=this.rate(aggregate.synapseAdditionsPerSecond,'additions/s');
      this.$('miner-compute-rate-label').textContent=this.t('30 s window')+' · '+this.t('Sampled {seconds} s',{seconds:seconds(aggregate.sampledMs)})+' · '+this.t('5 s recent')+' '+this.rate(aggregate.recentNeuronUpdatesPerSecond,'neuron updates/s')+' · '+this.t('Session average')+' '+this.rate(aggregate.sessionNeuronUpdatesPerSecond,'neuron updates/s');
      const node=this.$('miner-work-counts');if(node)node.textContent=this.t('Actual cumulative work: {neurons} neuron updates; {synapses} synaptic additions.',{neurons:aggregate.totalNeuronUpdates,synapses:aggregate.totalSynapseAdditions});
    }
    const host=this.$('miner-compute-log'),following=host.scrollTop+host.clientHeight>=host.scrollHeight-16;
    if(this.lastLogRow!==this.log.rows.at(-1)||this.lastLocale!==this.locale()){host.textContent=computationLogText(report,this.t,this.locale());if(following)host.scrollTop=host.scrollHeight;this.lastLogRow=this.log.rows.at(-1);this.lastLocale=this.locale();}
    this.$('miner-compute-export').disabled=!report.entries.length;
  }
  download(){const url=URL.createObjectURL(new Blob([computationLogText(this.log.summary(),this.t,this.locale())],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='flybrain-calculation-log.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  dispose(){clearInterval(this.timer);}
}
