// Display effects read existing observations; they never start work or advance progress.
export function setMiningButtonLabel(button,label){
  if(!button)return;
  let text=button.querySelector('.mining-button-label');
  if(!text){const spinner=document.createElement('span');spinner.className='mining-button-spinner';spinner.setAttribute('aria-hidden','true');text=document.createElement('span');text.className='mining-button-label';button.replaceChildren(spinner,text);}
  if(text.textContent!==label)text.textContent=label;
}
export function showMiningButtonBusy(button,busy,label=null){
  if(!button)return;button.classList.toggle('is-loading',busy);button.setAttribute('aria-busy',String(busy));
  if(busy){button.disabled=true;if(label)setMiningButtonLabel(button,label);}
}
export function showMiningProgress(progress,active){
  let shell=progress.parentElement;
  if(!shell.classList.contains('mining-progress-shell')){
    shell=document.createElement('div');shell.className='mining-progress-shell';progress.before(shell);
    const visual=document.createElement('span'),fill=document.createElement('span');visual.className='mining-progress-visual';visual.setAttribute('aria-hidden','true');fill.className='mining-progress-fill';visual.append(fill);shell.append(progress,visual);
  }
  shell.hidden=progress.hidden;shell.dataset.active=String(!!active);
  const known=progress.hasAttribute('value')&&Number.isFinite(progress.value)&&progress.max>0;
  shell.dataset.indeterminate=String(!known);shell.querySelector('.mining-progress-fill').style.width=known?Math.max(0,Math.min(100,progress.value/progress.max*100))+'%':'';
}
const safeNumber=value=>Number.isFinite(Number(value))?String(Number(value)):'';
const shortId=value=>typeof value==='string'&&/^[a-f0-9]{16,64}$/.test(value)?value.slice(0,12):'';
export function miningBackdropRecord(row,t=(s,v)=>s){
  const m=row.telemetry,time=Number.isFinite(row.sessionElapsedMs)?'['+(row.sessionElapsedMs/1000).toFixed(1)+' s] ':'';
  if(row.event==='task')return {text:time+t('Computing candidate {candidate} · background {background}',{candidate:shortId(row.candidateId)||safeNumber(row.k),background:typeof row.repeatIndex==='number'?row.repeatIndex+1:1})};
  if(row.event==='progress'&&m){const stage={validating:'Checking experiment inputs',results:'Building the response archive',saving:'Saving the computed result',paused:'Current work paused',error:'Computation needs attention'}[m.stage];return {text:time+(stage?t(stage):t('Step {done}/{total} · neuron updates {neurons} · synaptic additions {synapses}',{done:safeNumber(m.completedSteps),total:safeNumber(m.totalSteps),neurons:safeNumber(m.neuronUpdates),synapses:safeNumber(m.synapseTransmissions)}))};}
  if(row.event==='complete')return {text:time+t(row.saved===false?'Background completed · saving needs attention':row.sciencePassed?'Background qualified · result saved':'Background completed · result saved')};
  const labels={'round-closed':'Round closed',error:'Computation needs attention','submission-error':'Submission needs attention','save-error':'Saving needs attention','pause-requested':'Pause requested',stopped:'Computation stopped','cancelled-normal':'Current work paused'};
  return labels[row.event]?{text:time+t(labels[row.event])}:null;
}
export function candidateBackdropRecord(candidate,t=(s,v)=>s){
  const values={candidate:shortId(candidate.candidateId),round:safeNumber(candidate.round?.pre?.roundSequence)};
  if(!values.candidate)return null;
  if(candidate.financial?.finalized?.commitment==='finalized'&&candidate.won)return {text:t('Round {round} won · {candidate} · reward received',values),emphasis:true};
  if(candidate.won||candidate.phase==='winner-confirmed')return {text:t('Round {round} won · candidate {candidate}',values),emphasis:true};
  if(candidate.sciencePassed&&candidate.searchComplete&&!candidate.partial)return {text:t('Qualified candidate found · {candidate} · awaiting verification',values),emphasis:true};
  return null;
}
export class MiningLogBackdrop {
  constructor(host,{t=(s,v)=>s,limit=36}={}){
    this.host=host;this.t=t;this.limit=limit;this.rows=[];this.seen=new WeakSet();this.candidates=new Map();this.phase=null;this.progressKey=null;this.events=new AbortController();
    this.host.dataset.foreground='unavailable';this.anatomy=null;this.occlusion=null;
    this.track=document.createElement('div');this.track.className='mining-log-track';host.append(this.track);
    document.addEventListener('visibilitychange',()=>this.visibility(),{signal:this.events.signal});
    this.observer=new IntersectionObserver(entries=>{this.onScreen=entries[0].isIntersecting;this.visibility();});this.observer.observe(host);this.onScreen=true;
  }
  bindAnatomy(anatomy){
    if(this.anatomy===anatomy)return;
    this.occlusion?.dispose();this.occlusion=null;this.anatomy=anatomy;
    this.host.dataset.foreground=anatomy?'pending':'unavailable';
    if(!anatomy)return;
    Promise.all([anatomy.ready,import('./mining-log-occlusion.mjs?v=mining-depth-20261014-v2')]).then(([,module])=>{
      if(this.anatomy!==anatomy||!anatomy.alive)return;
      this.occlusion=module.installMiningLogOcclusion(anatomy);this.visibility();
    }).catch(()=>{if(this.anatomy===anatomy)this.host.dataset.foreground='unavailable';});
  }
  visibility(){
    const foreground=!!this.occlusion?.ready&&this.anatomy?.alive&&this.anatomy.outlines.visible;
    this.host.dataset.foreground=foreground?'anatomy':this.anatomy&&!this.occlusion?'pending':'unavailable';
    this.host.dataset.paused=String(this.host.hidden||document.hidden||!this.onScreen||!foreground);
  }
  add(record){if(!record)return;this.rows.push(record);if(this.rows.length>this.limit)this.rows.shift();this.changed=true;}
  update({preparation,progress,phaseLabel,logRows=[],candidates=[],visible=true,anatomy=null}={}){
    this.bindAnatomy(anatomy);
    const language=document.documentElement.lang;
    if(this.language!==language){this.language=language;this.rows=[];this.seen=new WeakSet();this.candidates.clear();this.phase=null;this.progressKey=null;this.changed=true;}
    this.host.hidden=!visible;
    if(preparation&&preparation!==this.phase){this.phase=preparation;this.add({text:this.t('Preparation')+' / '+phaseLabel});}
    if(progress?.total>0){const key=[preparation,progress.done,progress.total].join('/');if(key!==this.progressKey){this.progressKey=key;this.add({text:phaseLabel+' / '+safeNumber(progress.done)+' / '+safeNumber(progress.total)});}}
    for(const row of logRows){if(this.seen.has(row))continue;this.seen.add(row);this.add(miningBackdropRecord(row,this.t));}
    for(const candidate of candidates){const record=candidateBackdropRecord(candidate,this.t);if(!record||this.candidates.get(candidate.candidateId)===record.text)continue;this.candidates.set(candidate.candidateId,record.text);if(this.candidates.size>200)this.candidates.delete(this.candidates.keys().next().value);this.add(record);}
    if(this.changed){
      const group=document.createElement('div');group.className='mining-log-group';
      for(const row of this.rows){const line=document.createElement(row.emphasis?'strong':'div');line.className='mining-log-line';line.textContent=row.text;group.append(line);}
      this.track.replaceChildren(group,group.cloneNode(true));this.host.dataset.entries=String(this.rows.length);this.changed=false;
    }
    this.visibility();
  }
  dispose(){this.anatomy=null;this.occlusion?.dispose();this.occlusion=null;this.events.abort();this.observer.disconnect();}
}
