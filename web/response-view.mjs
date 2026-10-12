import { jsonBytes, digest } from './response-record.mjs';
import { LiveObservationView } from './live-observation-view.mjs';
import { exportFiles } from './artifact-export.mjs';
import { validateTrace } from './propagation-trace.mjs';
const $=id=>document.getElementById(id),t=(s,v={})=>window.FlyI18n.t(s,v);
export class ResponseView {
  constructor(config,{loadFull,onSelect=()=>{},onError=()=>{},onSubscribe=()=>{},onAck=()=>{},onRequest=()=>{}}={}){
    Object.assign(this,{config,loadFull,onSelect,onError});this.bundle=null;this.mode='live';this.live=null;
    this.propagation=new LiveObservationView({config,t,onSubscribe,onAck,onRequest});
    $('research-download').onclick=()=>this.download(false).catch(onError);$('research-bundle').onclick=()=>this.download(true).catch(onError);$('propagation-trace-export').onclick=()=>this.exportTrace();
  }
  barrier(scope,task){this.live=scope;this.propagation.barrier(scope,task);}
  receive(message){return this.propagation.receive(message);}
  async render(bundle,{explicit=true,preserveCursor=false}={}){
    this.bundle=bundle;const config=bundle.config||this.config;
    if(bundle.trace)validateTrace(bundle.trace,config,bundle.task,bundle.resultHash);
    const s=bundle.record.summary;
    $('miner-result-details').hidden=false;
    $('research-download').hidden=false;$('research-bundle').hidden=false;$('propagation-trace-export').hidden=!bundle.trace;
    for(const [id,value]of [['research-a',s.global[0]],['research-b',s.global[1]],['research-active-a',s.global[2]],['research-active-b',s.global[3]],['research-bytes',bundle.responseBytes??bundle.archive?.byteLength??bundle.archive?.size]])$(id).textContent=BigInt(value).toLocaleString(window.FlyI18n.language);
    const max=Math.max(1,...s.time.map(Math.abs)),observe=config.observe_start||0,observed=config.steps-observe;
    $('research-bins').replaceChildren(...s.time.map((v,i)=>{const column=document.createElement('button'),bar=document.createElement('span');column.type='button';column.className='response-bin';column.dataset.bin=String(i);bar.style.height=(Math.abs(v)/max*50)+'%';bar.style.top=v>=0?(50-Math.abs(v)/max*50)+'%':'50%';bar.dataset.sign=v<0?'negative':v>0?'positive':'zero';column.append(bar);column.title=t('Steps {start}–{end}: {spikes} B−A model spikes',{start:observe+Math.floor(i*observed/32),end:observe+Math.floor((i+1)*observed/32)-1,spikes:v});column.setAttribute('aria-label',column.title);column.onclick=()=>{let value=$('research-bin-value');if(!value){value=document.createElement('p');value.id='research-bin-value';$('research-bins').after(value);}value.textContent=column.title;};return column;}));
    $('research-top').replaceChildren(...s.top.map(x=>{const row=document.createElement('tr');for(const v of [x.bodyId,x.delta,x.firstStep]){const td=document.createElement('td');td.textContent=String(v);row.append(td);}return row;}));
    $('research-result-hash').textContent='SHA-256 '+bundle.resultHash;
    $('research-bundle').disabled=!bundle.archive&&!bundle.localArchive;this.onSelect(bundle);
    this.translate();

    return true;
  }
  translate(){
    this.propagation.translate();
    if(this.bundle){
      const bundle=this.bundle,task=bundle.task,config=bundle.config||this.config,verified=bundle.record.verification==='CHAIN_ARCHIVED';
      $('miner-result-summary').textContent=t(verified?'Archived full-model test response for cell {body}. {status}':'You completed a full-model experiment for cell {body}. {status}',{body:task.bodyId,status:t(verified?'Accepted and archived test response.':bundle.saveError?'Completed in this session · save failed. Export before closing.':'Saved on this device · not independently verified.')});
      $('research-identity').textContent=t('Cell {body} · task {task} · {status}',{body:task.bodyId,task:task.k,status:t(verified?'Archived chain result':'Local unverified result')});
      $('research-waveform').textContent=t('Rectangular input: steps {start}–{end}, model current {current}; seed {seed}.',{start:task.stimulus.start_step,end:task.stimulus.end_step-1,current:task.stimulus.current,seed:task.seed.toString(16).padStart(16,'0')});
      $('artifact-verification').textContent=t(bundle.trace?'Local core observation; its side-file hash binds it to this result. It is not independently verified or part of the chain archive.':'Connection trace is missing or unavailable. The original spike preview and scientific result remain usable.');
      const observe=config.observe_start||0,observed=config.steps-observe;
      for(const bar of $('research-bins').children){const i=Number(bar.dataset.bin);bar.title=t('Steps {start}–{end}: {spikes} B−A model spikes',{start:observe+Math.floor(i*observed/32),end:observe+Math.floor((i+1)*observed/32)-1,spikes:bundle.record.summary.time[i]});}
    }else{
      $('miner-result-summary').textContent='';$('artifact-verification').textContent='';
    }
    if(this.bundle?.task.protocolVersion===2){const b=this.bundle;const zh=window.FlyI18n.language.startsWith('zh');$('miner-result-summary').textContent=zh?(b.saveError?'完整仿真背景待保存，可重试或下载。':'完整仿真背景已保存；本地达标、重放和本轮胜出分别裁决。'):(b.saveError?'Complete simulation background awaits storage; retry or download.':'Complete simulation background saved; local qualification, replay and winning are separate decisions.');$('research-identity').textContent=`${zh?'仿真产物：轮次':'Simulation artifact: round'} ${b.task.roundId.slice(0,12)} · ${zh?'候选':'candidate'} ${b.task.candidateId.slice(0,12)} · ${zh?'背景':'background'} ${b.task.repeatIndex+1}`;}

  }
  markUnfinished(reason){this.propagation.stage(this.live,reason);}
  markRunning(){this.propagation.stage(this.live,'simulation');}
  async full(){const b=this.bundle;if(b?.archive)return b;if(b?.localArchive){const full=await this.loadFull(b.task);if(full.resultHash!==b.resultHash)throw new Error('Local result hash mismatch');return full;}return b;}
  async download(zip){
    const b=await this.full();if(!b)return;
    if(!b.archive){const a=document.createElement('a');a.href=b.archiveUrl;a.rel='noopener noreferrer';a.target='_blank';a.click();return;}
    if(zip){const files=[{name:'response.bin',data:b.archive},{name:'preview.json',data:new Blob([b.previewBytes])},{name:'manifest.json',data:new Blob([b.manifestBytes])},{name:'record.json',data:new Blob([jsonBytes(b.record)])}];if(b.trace)files.push({name:'display-trace.json',data:new Blob([jsonBytes(b.trace)])});await exportFiles(files,(b.task.trialId||b.task.taskId)+'-background.zip');return;}
    const url=URL.createObjectURL(b.archive instanceof Blob?b.archive:new Blob([b.archive])),a=document.createElement('a');a.href=url;a.download=(b.task.trialId||b.task.taskId)+'-response.bin';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  exportTrace(){if(!this.bundle?.trace)return;const url=URL.createObjectURL(new Blob([jsonBytes(this.bundle.trace)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='propagation-'+this.bundle.task.taskId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  hide(){this.propagation.hide();}
  show(){this.propagation.show();$('research-response').hidden=false;}
  reset(){this.propagation.barrier(null);this.live=null;}
  dispose(){this.propagation.dispose();this.bundle=null;}
}
