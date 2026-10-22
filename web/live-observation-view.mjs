import { MiningAnatomy } from './mining-anatomy.mjs';
import { LiveObservationController, sameScope, epochNow } from './live-observation.mjs';
const $=id=>document.getElementById(id),say=(zh,en)=>window.FlyI18n?.language?.startsWith('zh')?zh:(window.FlyI18n?.t?.(en)||en),short=s=>String(s||'—').slice(0,10);
export class LiveObservationView {
  constructor({config,t=s=>s,onSubscribe=()=>{},onAck=()=>{},onRequest=()=>{}}={}){
    Object.assign(this,{config,t,onSubscribe,onAck,onRequest,visible:true,graphicsEnabled:true,mode:'b',frame:null,geometrySelection:null,raf:null});
    try{this.graphicsEnabled=localStorage.getItem('flypow-mining-graphics-v1')!=='off';}catch{}
    try{const settings=JSON.parse(localStorage.getItem('flypow-display-settings-v2')||'null');if(settings){if(typeof settings.outline==='boolean')$('anatomy-outline').checked=settings.outline;if(typeof settings.rotate==='boolean')$('anatomy-rotate').checked=settings.rotate;if(Number.isFinite(settings.opacity)&&settings.opacity>=0&&settings.opacity<=1)$('anatomy-opacity').value=settings.opacity;if(['low','normal','high'].includes(settings.quality))$('anatomy-quality').value=settings.quality;}}catch{}
    this.canvas=$('propagation-canvas');this.context=this.canvas.getContext('2d');this.motion=matchMedia('(prefers-reduced-motion: reduce)');
    this.controller=new LiveObservationController({onBarrier:()=>{this.frame=null;this.geometrySelection=null;this.scene?.clearActivity();this.context?.clearRect(0,0,this.canvas.width,this.canvas.height);cancelAnimationFrame(this.raf);this.raf=null;this.describe();},onDraw:f=>this.draw(f),onAck,onRequest});
    $('miner-graphics').onchange=()=>this.setGraphicsEnabled($('miner-graphics').checked);
    $('research-live-mode').onchange=()=>{this.mode=$('research-live-mode').value;this.schedule();};
    $('anatomy-retry').onclick=()=>this.retryDisplay().catch(e=>this.failure(e));
    $('anatomy-outline').onchange=()=>{this.scene?.setOutlineVisible($('anatomy-outline').checked);this.remember();};
    $('anatomy-opacity').oninput=()=>{this.scene?.setOutlineOpacity($('anatomy-opacity').value);this.remember();};
    $('anatomy-quality').onchange=()=>{this.scene?.setQuality($('anatomy-quality').value).then(()=>this.schedule()).catch(e=>this.failure(e));this.remember();};
    $('anatomy-rotate').onchange=()=>{this.remember();this.schedule();};
    const settings=$('anatomy-display-settings');this.dismissSettings=e=>{if(settings.open&&!settings.contains(e.target))settings.open=false;};this.settingsKey=e=>{if(e.key==='Escape'&&settings.open){settings.open=false;settings.querySelector('summary').focus();}};document.addEventListener('pointerdown',this.dismissSettings);document.addEventListener('keydown',this.settingsKey);
    $('propagation-cell').onchange=()=>{this.selected={type:'cell',index:Number($('propagation-cell').value)};if(this.scene)this.scene.selectedCell=this.selected.index;this.schedule();};
    $('propagation-edge').onchange=()=>{this.selected={type:'edge',index:Number($('propagation-edge').value)};this.schedule();};
    this.visibility=()=>this.subscription();document.addEventListener('visibilitychange',this.visibility);
    this.motionChange=()=>{this.schedule();this.describe();};this.motion.addEventListener('change',this.motionChange);
    this.resize=new ResizeObserver(()=>{this.layout();this.schedule();});this.resize.observe(this.canvas.parentElement);
    this.initScene();this.setGraphicsEnabled(this.graphicsEnabled,{remember:false});this.describe();
  }
  initScene(){if(this.scene||!this.graphicsEnabled)return;
    try{this.displayState('loading');const scene=this.scene=new MiningAnatomy($('anatomy-stage'),{config:this.config,t:this.t,onFailure:e=>this.failure(e),onSelect:s=>{this.selected=s;$('propagation-inspector').open=true;this.schedule();},onInteract:()=>{this.rotationHoldUntil=performance.now()+2000;this.schedule();}});scene.onScreenChange=()=>this.subscription();scene.onVisible=()=>{if(scene.initialFitPending)scene.frameBrain(scene.whole);this.schedule();};scene.quality=$('anatomy-quality').value;scene.setOutlineVisible($('anatomy-outline').checked);scene.setOutlineOpacity($('anatomy-opacity').value);scene.ready.then(()=>{if(this.scene===scene){this.displayState('3d');this.setGeometry();this.schedule();this.describe();}});this.fallback=false;}catch(e){this.failure(e);}
  }
  failure(e){if(e.name==='AbortError')return;this.lastDisplayError=e.message;const old=this.scene;this.failedCamera=old?.snapshotCamera()||this.failedCamera;this.scene=null;old?.dispose();this.fallback=true;this.displayState('fallback');this.describe();this.layout();this.schedule();}
  async retryDisplay(){const camera=this.scene?.snapshotCamera()||this.failedCamera;this.scene?.dispose();this.scene=null;this.lastDisplayError=null;this.geometrySelection=null;this.initScene();const scene=this.scene;if(!scene)return;await scene.ready;if(this.scene!==scene)return;if(camera)Object.assign(scene,camera);this.displayState('3d');this.layout();this.setGeometry();this.subscription();this.describe();}
  displayState(mode){this.displayMode=this.graphicsEnabled?mode:'off';$('anatomy-stage').hidden=!this.graphicsEnabled||mode==='fallback';this.canvas.hidden=!this.graphicsEnabled||mode!=='fallback';$('anatomy-disabled').hidden=this.graphicsEnabled;if($('anatomy-loading'))$('anatomy-loading').hidden=!this.graphicsEnabled||mode!=='loading';}
  barrier(scope,task){this.task=task;this.controller.barrier(scope);this.subscription();}
  receive(m){const accepted=this.controller.receive(m);if(accepted){this.metadata=m.metadata;this.setGeometry();this.schedule();}return accepted;}
  progress(scope,m){this.controller.progress(scope,m);this.describe();}
  stage(scope,stage){if(!sameScope(scope,this.controller.scope))return;this.controller.stage=stage;this.describe();this.schedule();}
  setGeometry(){const metadata=this.metadata,scope=this.controller.scope;if(!metadata||metadata.executionId!==scope?.executionId||!this.scene?.context)return;
    const key=metadata.graphRoot+'/'+JSON.stringify([metadata.cells.map(c=>[c.index,c.bodyId]),metadata.edges]);if(key===this.geometrySelection)return;this.geometrySelection=key;
    const scene=this.scene,token={...scope};scene.setTrace(metadata).then(()=>{if(this.scene!==scene||!sameScope(this.controller.scope,token))return;this.describe();this.schedule();}).catch(e=>{if(this.scene===scene&&sameScope(this.controller.scope,token))this.failure(e);});
    $('propagation-cell').replaceChildren(...metadata.cells.map(c=>new Option(c.bodyId,String(c.index))));$('propagation-edge').replaceChildren(new Option(say('选择模型连接','Select model connection'),''),...metadata.edges.map(e=>new Option(`${e.sourceIndex} → ${e.targetIndex} (${e.signedCurrent})`,String(e.edgeId))));
    $('propagation-inspector').hidden=false;
  }
  subscription(){const enabled=this.graphicsEnabled&&this.visible&&!document.hidden&&(this.fallback||this.scene?.onScreen!==false);this.controller.setEnabled(enabled);this.onSubscribe(enabled);if(this.scene)this.scene.visible=this.visible&&this.graphicsEnabled;if(enabled)this.schedule();else{cancelAnimationFrame(this.raf);this.raf=null;}}
  setGraphicsEnabled(enabled,{remember=true}={}){this.graphicsEnabled=!!enabled;if(remember)try{localStorage.setItem('flypow-mining-graphics-v1',enabled?'on':'off');}catch{}
    $('miner-graphics').checked=!!enabled;if(enabled)this.initScene();this.displayState(this.fallback?'fallback':this.scene?.context?'3d':'loading');this.layout();this.subscription();this.describe();}
  setVisible(visible){this.visible=!!visible;this.subscription();}
  hide(){this.setVisible(false);}
  show(){this.setVisible(true);}
  schedule(){if(this.raf!==null||!this.controller.enabled||!this.visible||!this.graphicsEnabled||document.hidden)return;this.raf=requestAnimationFrame(at=>{
    this.raf=null;const interval=this.scene?.softwareRenderer?100:50;if(at-(this.lastDrawAt||0)<interval){this.schedule();return;}
    if(this.scene?.loadingGeometry||this.scene&&!this.scene.context){this.schedule();return;}
    const rotate=!!this.scene?.context&&$('anatomy-rotate').checked&&!this.motion.matches;
    // Camera rotation shares the existing display clock. It creates no neural
    // events, never starts a second renderer loop, and sleeps with the display.
    if(rotate&&!this.scene.dragging&&at>=(this.rotationHoldUntil||0))this.scene.yaw+=Math.min(.1,Math.max(0,at-(this.lastDrawAt||at))/1000)*.055;
    this.lastDrawAt=at;const frame=this.controller.consume(this.mode,this.motion.matches);if(!frame&&rotate)this.scene.draw();this.describe();
    if(rotate||this.controller.pending||[...this.controller.events.values()].some(e=>epochNow()-e.bornEpochMs<300))this.schedule();
  });}
  layout(){const r=this.canvas.parentElement.getBoundingClientRect();this.width=Math.max(1,r.width);this.height=Math.max(1,r.height);const dpr=Math.min(1.5,devicePixelRatio||1);this.canvas.width=Math.round(this.width*dpr);this.canvas.height=Math.round(this.height*dpr);this.context?.setTransform(dpr,0,0,dpr,0,0);}
  draw(f){this.frame=f;this.scene?.update(f,{reduced:this.motion.matches,time:f.step});
    if(this.fallback&&this.context){const ctx=this.context,cells=f.metadata.cells,pos=new Map(cells.map((c,i)=>[c.index,{x:this.width/2+Math.cos(2*Math.PI*i/cells.length)*this.width*.38,y:this.height/2+Math.sin(2*Math.PI*i/cells.length)*this.height*.38}]));ctx.clearRect(0,0,this.width,this.height);
      for(const e of f.metadata.edges){const a=pos.get(e.sourceIndex),b=pos.get(e.targetIndex);if(!a||!b)continue;ctx.strokeStyle='#888888';ctx.globalAlpha=.25;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
      for(const item of f.activities){const a=pos.get(item.event[2]),b=pos.get(item.event[3]);if(!a||!b)continue;const u=item.progress,tail=Math.max(0,u-.18);ctx.strokeStyle='#fffdf9';ctx.globalAlpha=item.strength;ctx.lineCap='round';ctx.shadowColor='#fff';ctx.shadowBlur=4;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(a.x+(b.x-a.x)*tail,a.y+(b.y-a.y)*tail);ctx.lineTo(a.x+(b.x-a.x)*u,a.y+(b.y-a.y)*u);ctx.stroke();}ctx.shadowBlur=0;ctx.globalAlpha=1;
      for(const {cell,lanes}of f.states){const p=pos.get(cell.index);ctx.fillStyle=lanes.some(l=>l.row?.[3])?'#fff':'#999999';ctx.beginPath();ctx.arc(p.x,p.y,2,0,Math.PI*2);ctx.fill();}
    }
    const active=f.states.flatMap(s=>s.lanes).filter(l=>l.row?.[3]);$('propagation-activity').textContent=active.length?say(`最新完整步发放：A ${active.filter(l=>l.lane===0).length} / B ${active.filter(l=>l.lane===1).length}`,`Latest complete step firing: A ${active.filter(l=>l.lane===0).length} / B ${active.filter(l=>l.lane===1).length}`):say('近期未观察到发放；没有生成装饰电流。','No recent observed firing; no synthetic current.');
    const cell=f.states.find(s=>s.cell.index===this.selected?.index);$('propagation-detail').textContent=cell?`${cell.cell.bodyId} · step ${f.step}\n`+cell.lanes.map(l=>`${l.lane?'B':'A'}: ${l.row?JSON.stringify({spike:l.row[3],incoming:l.row[6],background:l.row[7],stimulus:l.row[8],before:l.row[9],after:l.row[12]}):say('等待完整状态','Awaiting complete state')}`).join('\n'):this.selected?.type==='edge'?JSON.stringify(f.metadata.edges.find(e=>e.edgeId===this.selected.index),null,2):say('只展示当前观察集合；未采集细胞没有当前状态。','Only the observed selection is available; uncollected cells have no current state.');
    this.describe();
  }
  describe(){const s=this.controller.snapshot(),scope=s.scope,step=s.renderedStep;
    $('anatomy-view-state').textContent=scope?say(`正在观察线程 ${this.task?.viewWorkerNumber||1} · 当前候选 ${short(scope.candidateId||scope.executionId)} · 背景 ${this.task?.repeatIndex+1||'—'}`,`Observing worker ${this.task?.viewWorkerNumber||1} · candidate ${short(scope.candidateId||scope.executionId)} · background ${this.task?.repeatIndex+1||'—'}`):say('等待当前计算','Awaiting current computation');
    $('anatomy-state').textContent=this.lastDisplayError?say('3D 资源不可用 · 当前状态二维回退','3D resources unavailable · current-state 2D fallback'):s.synchronizing?say('正在同步最新状态','Synchronizing latest state'):this.scene?.loadingGeometry?say('加载真实神经骨架','Loading real morphology'):!scope?say('没有活跃计算','No active computation'):step<0?say('当前步计算中，等待首份完整状态','Current step computing; awaiting first complete state'):['paused','stopped','complete','saving','results'].includes(s.stage)?say(`当前阶段：${({paused:'暂停',stopped:'停止',complete:'完成',saving:'保存',results:'生成结果'})[s.stage]} · 最新静态状态`,`Current stage: ${s.stage} · latest static state`):say('实时','Live');
    $('research-frame').textContent='';
    $('propagation-identity').textContent=scope?`round ${scope.roundId||'offline'}\ncandidate ${scope.candidateId||'—'}\ntrial ${scope.trialId||'—'}\nexecution ${scope.executionId}`:'';
    $('propagation-scope').textContent=this.metadata&&scope?.executionId===this.metadata.executionId?say(`观察 ${this.metadata.cells.length} 个细胞和 ${this.metadata.edges.length} 条真实连接；最近最多 8 个完整步。完整科学事件独立归档。`,`Observing ${this.metadata.cells.length} cells and ${this.metadata.edges.length} real connections; up to 8 recent complete steps. Full scientific events are archived separately.`):'';
    $('anatomy-disabled').textContent=say('图形已关闭 · 已获允许的计算继续','Graphics off · explicitly authorized computation continues');
    $('propagation-motion-note').textContent=this.motion.matches?say('减少动态：最新状态和静态活动仍更新，流动装饰已关闭。','Reduced motion: latest state and static activity update; moving decoration is off.'):say('显示可跳过中间步，不等待动画；不改变科学计算。','Display may skip intermediate steps without waiting for animation; science is unchanged.');
    $('anatomy-error').hidden=!this.lastDisplayError;$('anatomy-error').textContent=this.lastDisplayError?say('3D 暂不可用；可使用二维视图或重试显示。','3D unavailable; use the 2D view or retry display.'):'';
    $('live-observation-diagnostics').textContent=JSON.stringify({...s,displayError:this.lastDisplayError||null,displayMode:this.displayMode,geometryReady:this.scene?.host.dataset.geometry,clockMapping:'timeOrigin + performance.now shared epoch',physicalDeviceTested:false},null,2);
  }
  remember(){try{localStorage.setItem('flypow-display-settings-v2',JSON.stringify({outline:$('anatomy-outline').checked,rotate:$('anatomy-rotate').checked,opacity:Number($('anatomy-opacity').value),quality:$('anatomy-quality').value}));}catch{}}
  translate(){this.describe();}
  snapshot(){return this.controller.snapshot();}
  dispose(){cancelAnimationFrame(this.raf);this.scene?.dispose();this.resize.disconnect();document.removeEventListener('visibilitychange',this.visibility);document.removeEventListener('pointerdown',this.dismissSettings);document.removeEventListener('keydown',this.settingsKey);this.motion.removeEventListener('change',this.motionChange);}
}
