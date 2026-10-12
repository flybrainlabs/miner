import { MiningAnatomy } from './mining-anatomy.mjs';
import { TraceIndex } from './propagation-trace.mjs';
import { ReplayController } from './replay-controller.mjs';
import { replayFrame } from './response-record.mjs';
const $=id=>document.getElementById(id);
const color={positive:'#d8ff85',negative:'#fa9292',a:'#a6b7d8',quiet:'#7d8990'};
export class PropagationView {
  constructor({config,t=s=>s,onInteract=()=>{},onFrame=()=>{}}={}){
    Object.assign(this,{t,onInteract,onFrame,config});this.trace=null;this.preview=null;this.selected=null;this.frame=null;this.follow=true;this.rasterLayers=[];this.rasterAt=0;this.visible=true;
    this.graphicsEnabled=true;try{this.graphicsEnabled=localStorage.getItem('flypow-mining-graphics-v1')!=='off';}catch{}
    this.canvas=$('propagation-canvas');this.context=this.canvas.getContext('2d');this.raster=$('propagation-raster');this.rasterContext=this.raster.getContext('2d');
    this.replay=new ReplayController({onFrame:f=>this.draw(f),onState:s=>{$('research-play').setAttribute('aria-pressed',String(s==='playing'||s==='waiting'));$('research-play').textContent=this.t(s==='playing'||s==='waiting'?'Pause playback':'Play recorded propagation');}});
    const action=fn=>()=>{this.follow=false;this.onInteract();fn();};
    $('research-play').disabled=true;
    $('research-play').onclick=action(()=>this.replay.playing?this.replay.pause():this.replay.play());
    $('research-time').oninput=action(()=>this.replay.seek(Number($('research-time').value)));
    $('research-replay-mode').onchange=action(()=>this.replay.setMode($('research-replay-mode').value));
    $('propagation-speed').onchange=action(()=>this.replay.setSpeed(Number($('propagation-speed').value)));
    $('propagation-prev').onclick=action(()=>this.replay.stepBackward());$('propagation-next').onclick=action(()=>this.replay.stepForward());$('propagation-restart').onclick=action(()=>{this.replay.play({restart:true});});
    $('propagation-loop').onchange=action(()=>this.replay.setLoop($('propagation-loop').checked));
    $('propagation-window-apply').onclick=action(()=>{try{this.replay.setWindow(Number($('propagation-window-start').value),Number($('propagation-window-end').value));$('research-time').min=this.replay.start;$('research-time').max=this.replay.end-1;}catch{$('propagation-detail').textContent=this.t('Choose a valid window inside the recorded model steps.');}});
    $('propagation-cell').onchange=action(()=>{this.selected={type:'cell',index:Number($('propagation-cell').value)};if(this.scene)this.scene.selectedCell=this.selected.index;$('propagation-inspector').hidden=false;if(this.frame)this.draw(this.frame);});
    $('propagation-edge').onchange=action(()=>{this.selected={type:'edge',index:Number($('propagation-edge').value)};$('propagation-inspector').hidden=false;if(this.frame)this.draw(this.frame);});
    this.canvas.onclick=e=>{this.follow=false;this.onInteract();const r=this.canvas.getBoundingClientRect(),x=(e.clientX-r.left)*this.width/r.width,y=(e.clientY-r.top)*this.height/r.height;let nearest=null,dist=20;for(const [index,p]of this.positions||[]){const d=Math.hypot(x-p.x,y-p.y);if(d<dist){dist=d;nearest=index;}}if(nearest!=null){this.selected={type:'cell',index:nearest};$('propagation-inspector').hidden=false;$('propagation-inspector').open=true;$('propagation-cell').value=String(nearest);this.draw(this.frame);}};
    this.canvas.onkeydown=e=>{if(e.key===' '){e.preventDefault();$('research-play').click();}if(e.key==='ArrowRight'){e.preventDefault();$('propagation-next').click();}if(e.key==='ArrowLeft'){e.preventDefault();$('propagation-prev').click();}};
    this.scene=null;this.fallback=false;
    $('anatomy-outline').onchange=()=>{this.scene?.setOutlineVisible($('anatomy-outline').checked);this.rememberDisplay();};
    $('anatomy-opacity').oninput=()=>{this.scene?.setOutlineOpacity($('anatomy-opacity').value);this.rememberDisplay();};
    $('anatomy-quality').onchange=()=>{this.scene?.setQuality($('anatomy-quality').value).catch(e=>this.geometryError(e));this.rememberDisplay();};
    $('anatomy-retry').onclick=()=>this.retryDisplay().catch(e=>this.geometryError(e));
    try{const saved=JSON.parse(localStorage.getItem('flypow-display-settings-v2')||'null');if(saved){$('anatomy-outline').checked=saved.outline;$('anatomy-opacity').value=saved.opacity;$('anatomy-quality').value=saved.quality;}}catch{}
    $('miner-graphics').onchange=()=>this.setGraphicsEnabled($('miner-graphics').checked);
    $('propagation-raster').closest('details').addEventListener('toggle',()=>{if(this.frame&&this.graphicsEnabled)this.drawRaster(this.frame);});
    this.initScene();this.setGraphicsEnabled(this.graphicsEnabled,{remember:false});
    $('anatomy-follow').onclick=()=>{this.follow=true;this.onFollow?.();if(this.trace){this.replay.seek(this.replay.upper);if(this.graphicsEnabled)this.replay.play();}};
    this.resize=new ResizeObserver(()=>{this.layout();if(this.frame)this.draw(this.frame);});this.resize.observe(this.canvas.parentElement);
    this.motion=window.matchMedia('(prefers-reduced-motion: reduce)');this.motionChange=()=>{if(this.motion.matches)this.replay.suspend('reduced-motion');else this.replay.resume('reduced-motion');this.translate();};this.motion.addEventListener('change',this.motionChange);
    this.scheduleCheck=setInterval(()=>this.replay.recoverSchedule(!document.hidden&&this.visible&&this.graphicsEnabled&&(this.fallback||this.scene?.visible&&!this.scene.loadingGeometry)),1000);
  }
  initScene(){
    if(this.scene||this.fallback||!this.graphicsEnabled)return;
    const failure=e=>{this.lastDisplayError=e.message;this.fallback=true;const scene=this.scene;this.failedCamera=scene?.snapshotCamera()||this.failedCamera;this.scene=null;scene?.dispose();$('anatomy-stage').hidden=true;this.canvas.hidden=!this.graphicsEnabled;this.replay.resume('offscreen');$('anatomy-state').textContent=this.t('3D unavailable · 2D recorded trace');this.displayError();this.layout();if(this.frame)this.draw(this.frame);};
    try{this.scene=new MiningAnatomy($('anatomy-stage'),{config:this.config,t:this.t,onFailure:failure,onInteract:()=>{this.cameraInteractionAt=performance.now();},onSelect:selected=>{this.selected=selected;$('propagation-inspector').hidden=false;$('propagation-inspector').open=true;if(this.frame)this.draw(this.frame);}});this.scene.onScreenChange=visible=>{if(visible)this.replay.resume('offscreen');else this.replay.suspend('offscreen');};this.scene.visible=this.visible&&this.graphicsEnabled;this.replay.frameInterval=this.scene.softwareRenderer?250:50;this.canvas.hidden=true;this.scene.setOutlineVisible($('anatomy-outline').checked);this.scene.setOutlineOpacity($('anatomy-opacity').value);this.scene.quality=$('anatomy-quality').value;}catch(e){failure(e);}
  }
  setGraphicsEnabled(enabled,{remember=true}={}){
    if(!enabled)this.replay.suspend('graphics-off');
    this.graphicsEnabled=!!enabled;
    if(remember)try{localStorage.setItem('flypow-mining-graphics-v1',enabled?'on':'off');}catch{}
    $('miner-graphics').checked=this.graphicsEnabled;
    if(enabled)this.initScene();
    if(this.scene)this.scene.visible=this.visible&&this.graphicsEnabled;
    $('anatomy-stage').hidden=!enabled||this.fallback;this.canvas.hidden=!enabled||!this.fallback;
    $('anatomy-disabled').hidden=!!enabled;$('anatomy-disabled').textContent=this.t('Graphics off · computation continues');this.displayError();
    for(const id of ['anatomy-overview','anatomy-whole','anatomy-focus','anatomy-reset','anatomy-fullscreen','anatomy-follow','research-time','research-replay-mode','propagation-speed','propagation-prev','propagation-next','propagation-restart','propagation-loop'])$(id).disabled=!enabled;
    $('research-play').disabled=!enabled||!this.frame;
    if(enabled){
      if(this.pendingGeometry){this.pendingGeometry=false;this.scene?.setTrace(this.trace).catch(e=>this.geometryError(e));}
      if(this.frame)this.draw(this.frame);
      this.replay.resume('graphics-off');
    }
  }
  load({trace=null,preview=null,identity,live=false}){
    this.trace=trace;this.preview=preview;this.index=trace?new TraceIndex(trace):null;this.selected=null;this.follow=live;this.byEdge=new Map((trace?.edges||[]).map(e=>[e.edgeId,e]));
    const steps=trace?.steps||preview.steps,us=trace?.timeStepUs||preview.time_step_us;
    if(this.graphicsEnabled)this.scene?.setTrace(trace).catch(e=>this.geometryError(e));else this.pendingGeometry=true;
    $('research-time').min=trace?.observeStart||preview?.observe_start||0;$('research-time').max=steps-1;$('propagation-window-start').max=steps-1;$('propagation-window-end').max=steps;$('propagation-window-start').value=0;$('propagation-window-end').value=steps;
    $('propagation-cell').replaceChildren(...(trace?.cells||preview.cells.map(c=>({index:c.model_index,bodyId:c.body_id}))).map(c=>new Option(c.bodyId,String(c.index))));
    $('propagation-edge').replaceChildren(new Option(this.t('Select a model connection'),''),...(trace?.edges||[]).map(e=>new Option(`${e.sourceIndex} → ${e.targetIndex} (${e.signedCurrent})`,String(e.edgeId))));
    $('research-play').disabled=!this.graphicsEnabled;this.layout();this.replay.load({steps,timeStepUs:us,available:live?(trace.coverage.lastStep+1):steps,live,identity});this.replay.start=trace?.observeStart||preview?.observe_start||0;this.replay.seek(this.replay.start);this.resumeViewing=live;if(live)this.replay.play();this.translate();$('propagation-inspector').hidden=true;
  }
  append(trace){if(trace.executionId!==this.trace?.executionId)return;this.trace=trace;this.index.append(trace);this.updateRaster();this.replay.setAvailable(trace.coverage.lastStep+1);if(this.frame&&!this.replay.playing)this.draw(this.frame);}
  translate(){
    const trace=this.trace;
    $('propagation-scope').textContent=this.t(trace?'Observed subnet: {cells} cells, {edges} real model connections. Other inputs are included in core state.': 'Only recorded spikes are available. Connection paths and membrane states are unavailable.',{cells:trace?.cells.length,edges:trace?.edges.length});
    $('propagation-identity').textContent=this.t(this.replay.live?'Live core observation · unfinished task; only received model time is available.':'Result replay · playback does not add computational work or contributions.');
    $('propagation-limits').textContent=this.t('Point-neuron model units. Events follow original SWC chains as morphology-guided illustrations, not measured branch voltage or conduction speed.');
    $('propagation-motion-note').textContent=this.replay.reducedMotion()?this.t('Reduced motion: use the step buttons or time cursor to inspect static recorded states.'):this.t('Live playback advances continuously through received steps. Viewing speed does not change computation.');
    $('anatomy-disabled').textContent=this.t('Graphics off · computation continues');this.displayError();if(this.frame)this.draw(this.frame);
  }
  layout(){
    const rect=this.canvas.parentElement.getBoundingClientRect();this.width=Math.max(280,rect.width||640);this.height=this.width<500?340:440;const dpr=Math.min(2,window.devicePixelRatio||1);
    for(const [canvas,height]of [[this.canvas,this.height],[this.raster,120]]){canvas.width=this.width*dpr;canvas.height=height*dpr;canvas.style.height=height+'px';canvas.getContext('2d')?.setTransform(dpr,0,0,dpr,0,0);}
    const cells=this.trace?.cells||[];this.positions=new Map();
    // Deterministic concentric layout. Geometry is schematic, with real edge identities.
    const target=cells.find(c=>c.stimulus),neighbors=cells.filter(c=>c!==target);if(target)this.positions.set(target.index,{x:this.width/2,y:this.height/2});
    neighbors.forEach((c,i)=>{const ring=i<16?0:1,j=ring?i-16:i,count=Math.min(ring?neighbors.length-16:neighbors.length,16),angle=2*Math.PI*j/Math.max(1,count)-Math.PI/2,radius=ring?.30:.44;this.positions.set(c.index,{x:this.width/2+Math.cos(angle)*this.width*radius,y:this.height/2+Math.sin(angle)*this.height*radius});});
    this.rasterLayers=[0,1].map(()=>{const canvas=document.createElement('canvas');canvas.width=this.width*dpr;canvas.height=120*dpr;canvas.getContext('2d')?.setTransform(dpr,0,0,dpr,0,0);return canvas;});this.rasterAt=0;this.rasterCells=new Map((this.trace?.cells||this.preview?.cells||[]).map((c,i)=>[c.index??c.body_id,i]));this.updateRaster();
  }
  draw(f){
    if(!f)return;this.frame=f;if(!this.visible||!this.graphicsEnabled)return;this.onFrame(f);$('anatomy-view-state').textContent=this.t(f.live?'Live observation · {id}':'Result replay · {id}',{id:String(f.identity||'').slice(0,10)});
    if(f.state==='error'){$('anatomy-state').textContent=this.t('Playback scheduling stopped. Use play to retry; computation and saved results are unaffected.');return;}
    $('anatomy-state').textContent=this.t(this.fallback?'3D unavailable · 2D recorded trace':this.scene?.loadingGeometry?'Morphology loading':this.scene?.geometryErrors?'Partial morphology load failure':f.waiting?'Waiting for recorded steps':f.intent==='paused'?'Viewing paused · computation is independent':f.state==='ended'?'End of recorded propagation':!this.trace?'Connection trace is missing or unavailable. The original spike preview and scientific result remain usable.':f.live&&this.replay.upper-f.time>4?'Watching behind computation':'Morphology-guided · recorded model events');$('research-time').value=f.time;
    $('research-frame').textContent=this.t('Model step {step} · {time} ms · viewing {speed}×',{step:f.step,time:(f.modelTimeUs/1000).toFixed(1),speed:f.speed});
    const ctx=this.fallback?this.context:null;if(ctx){ctx.clearRect(0,0,this.width,this.height);ctx.font='10px monospace';}
    if(!this.trace){
      if(this.preview){const step=Math.min(this.preview.steps-1,f.step);$('propagation-detail').textContent=this.preview.cells.map(c=>{const r=replayFrame(this.preview,c.body_id,step,f.mode);return `${c.body_id}: A ${r.a?'●':'–'} / B ${r.b?'●':'–'}`;}).join('\n');}
      this.drawRaster(f);return;
    }
    const frame=this.index.frame(f.time,f.mode);frame.previous=new Map(this.trace.cells.flatMap(c=>(f.mode==='difference'?[0,1]:[f.mode==='a'?0:1]).map(l=>[l+'/'+c.index,this.index.states.get(`${l}/${f.step-1}/${c.index}`)])));this.scene?.update(frame,{...f,reduced:this.motion.matches});if(f.state==='playing'&&!frame.moving.length&&!frame.arrived.length&&!frame.states.some(x=>x.lanes.some(y=>y.row?.[3])))$('anatomy-state').textContent=this.t('Playing · no firing in this observed subnet');
    $('anatomy-coverage').textContent=this.scene?this.t('{located} located cells · {missing} unlocated events remain in the inspector',{located:this.scene.mappedCount||0,missing:this.scene.unlocated||0}):'';
    const arrivingSigns=new Map();
    for(const event of frame.arrived){const key=event[0]+':'+event[3],sign=BigInt(event[6])<0n?2:BigInt(event[6])>0n?1:0;arrivingSigns.set(key,(arrivingSigns.get(key)||0)|sign);}
    const spikes=frame.states.flatMap(s=>s.lanes).filter(s=>s.row?.[3]),inputOn=f.step>=this.trace.stimulus.start_step&&f.step<this.trace.stimulus.end_step;
    $('propagation-activity').textContent=this.t(spikes.length?'Observed firing: A {a} / B {b}. Stimulus {status}.':'No recorded firing in this selected subnet at this model step. Stimulus {status}.',{a:spikes.filter(s=>s.lane===0).length,b:spikes.filter(s=>s.lane===1).length,status:this.t(inputOn?'on':'off')});
    if(ctx&&this.fallback){
      for(const e of this.trace.edges){const p=this.positions.get(e.sourceIndex),q=this.positions.get(e.targetIndex);if(!p||!q)continue;const inhibitory=BigInt(e.signedCurrent)<0n;ctx.strokeStyle=inhibitory?color.negative:color.quiet;ctx.lineWidth=this.selected?.type==='edge'&&this.selected.index===e.edgeId?2.5:1;ctx.setLineDash(inhibitory?[4,3]:[]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();const angle=Math.atan2(q.y-p.y,q.x-p.x),x=q.x-Math.cos(angle)*12,y=q.y-Math.sin(angle)*12;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-Math.cos(angle-.45)*7,y-Math.sin(angle-.45)*7);ctx.lineTo(x-Math.cos(angle+.45)*7,y-Math.sin(angle+.45)*7);ctx.closePath();ctx.fillStyle=ctx.strokeStyle;ctx.fill();}
      ctx.setLineDash([]);
      // Only actually received connections leave an afterglow. It fades within
      // this model step, independently of playback speed and computation.
      ctx.globalAlpha=1-frame.fraction;
      for(const event of frame.arrived){const p=this.positions.get(event[2]),q=this.positions.get(event[3]);if(!p||!q)continue;const negative=BigInt(event[6])<0n;ctx.strokeStyle=negative?color.negative:event[0]===0?color.a:color.positive;ctx.lineWidth=2.5;ctx.setLineDash(negative?[4,3]:[]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();}
      ctx.globalAlpha=1;ctx.setLineDash([]);
      for(const e of frame.moving){const p=this.positions.get(e[2]),q=this.positions.get(e[3]);if(!p||!q)continue;const x=p.x+(q.x-p.x)*frame.fraction,y=p.y+(q.y-p.y)*frame.fraction;ctx.fillStyle=BigInt(e[6])<0n?color.negative:e[0]===0?color.a:color.positive;ctx.strokeStyle=ctx.fillStyle;ctx.beginPath();if(e[0]===0)ctx.arc(x,y,3.5,0,Math.PI*2);else ctx.rect(x-3,y-3,6,6);e[0]===0?ctx.stroke():ctx.fill();}
      for(const {cell,lanes}of frame.states){const p=this.positions.get(cell.index),rows=lanes.map(x=>x.row).filter(Boolean),spike=rows.some(r=>r[3]),refractory=rows.some(r=>r[4]>0),input=rows.some(r=>BigInt(r[6])!==0n),inhibitory=rows.some(r=>BigInt(r[6])<0n),opposing=lanes.some(l=>arrivingSigns.get(l.lane+':'+cell.index)===3);if(!p)continue;ctx.fillStyle=spike?color.positive:'#172023';ctx.strokeStyle=cell.stimulus?'#fff':inhibitory?color.negative:input?color.a:color.quiet;ctx.setLineDash(refractory?[2,2]:[]);ctx.lineWidth=this.selected?.type==='cell'&&this.selected.index===cell.index?3:1.5;ctx.beginPath();ctx.arc(p.x,p.y,cell.stimulus?10:8,0,Math.PI*2);ctx.fill();ctx.stroke();if(opposing){ctx.beginPath();ctx.arc(p.x,p.y,13,0,Math.PI*2);ctx.stroke();}ctx.setLineDash([]);ctx.fillStyle='#ddd';ctx.fillText((cell.stimulus?'S ':'')+cell.bodyId.slice(-5)+(opposing?' ±':''),p.x-15,p.y+22);}
    }
    const chosen=this.selected?.type==='edge'?this.byEdge.get(this.selected.index):null;
    if(chosen){const events=[...frame.moving,...frame.arrived].filter(e=>e[1]===chosen.edgeId);$('propagation-detail').textContent=`edge ${chosen.edgeId}: ${chosen.sourceIndex} → ${chosen.targetIndex}\n${this.t('Signed model current')}: ${chosen.signedCurrent}\n`+events.map(e=>`A/B ${e[0]===0?'A':'B'}: ${e[4]} → ${e[5]}${e[5]>=this.trace.steps?' · '+this.t('Arrival outside the recorded window'):''}`).join('\n');}
    else{
      const cell=frame.states.find(x=>x.cell.index===this.selected?.index);
      $('propagation-detail').textContent=cell?`${cell.cell.bodyId} · index ${cell.cell.index}\n`+cell.lanes.map(({lane,row})=>{
        if(!row)return `${lane===0?'A':'B'}: ${this.t('No recorded state at this time')}`;
        const contributions=frame.arrived.filter(e=>e[0]===lane&&e[3]===cell.cell.index),visible=contributions.reduce((sum,e)=>sum+BigInt(e[6]),0n),other=BigInt(row[6])-visible;
        return `${lane===0?'A':'B'}: ${this.t(row[3]?'spike':row[4]>0?'Refractory; input not integrated':'Input received; no spike')}\n${this.t('Incoming / visible / other inputs')}: ${row[6]} / ${visible} / ${other}\n${this.t('Visible arriving connections')}: ${contributions.map(e=>`${e[1]} (${e[6]})`).join(', ')||'—'}\n${this.t('Background / stimulus')}: ${row[7]} / ${row[8]}\n${this.t('Before / leaked / integrated / after')}: ${row[9]} / ${row[10]} / ${row[11]} / ${row[12]}\n${this.t('Refractory before / after')}: ${row[4]} / ${row[5]}`;
      }).join('\n\n'):'';
    }
    $('propagation-outside').hidden=!frame.outside;$('propagation-outside').textContent=this.t('Arrival outside the recorded window; no later spike is inferred.');
    this.drawRaster(f);
  }
  updateRaster(){
    if(!this.graphicsEnabled||!this.raster.closest('details').open||this.rasterLayers.length!==2)return;const height=100/Math.max(1,this.rasterCells.size),paint=(lane,step,key)=>{const ctx=this.rasterLayers[lane].getContext('2d');if(!ctx)return;ctx.fillStyle=lane?color.positive:color.a;ctx.fillRect((step-(this.trace?.observeStart||this.preview?.observe_start||0))/((this.trace?.steps||this.preview.steps)-(this.trace?.observeStart||this.preview?.observe_start||0))*this.width,this.rasterCells.get(key)*height+4,2,Math.max(1,height-1));};
    if(this.trace){for(;this.rasterAt<this.trace.states.length;this.rasterAt++){const r=this.trace.states[this.rasterAt];if(r[3])paint(r[2],r[0],r[1]);}}
    else if(this.preview&&this.rasterAt===0){for(const [lane,events]of [this.preview.spikes_a,this.preview.spikes_b].entries())for(const [step,body]of events)paint(lane,step,body);this.rasterAt=1;}
  }
  drawRaster(f){if(!this.graphicsEnabled||!this.raster.closest('details').open)return;this.updateRaster();const ctx=this.rasterContext;if(!ctx)return;ctx.clearRect(0,0,this.width,120);
    for(const lane of f.mode==='difference'?[0,1]:[f.mode==='a'?0:1])if(this.rasterLayers[lane])ctx.drawImage(this.rasterLayers[lane],0,0,this.width,120);
    ctx.fillStyle='#ffffff';ctx.fillRect((f.time-(this.trace?.observeStart||this.preview?.observe_start||0))/((this.trace?.steps||this.preview?.steps||1)-(this.trace?.observeStart||this.preview?.observe_start||0))*this.width,0,1,120);
  }
  rememberDisplay(){try{localStorage.setItem('flypow-display-settings-v2',JSON.stringify({outline:$('anatomy-outline').checked,opacity:Number($('anatomy-opacity').value),quality:$('anatomy-quality').value}));}catch{}}
  displayError(){const el=$('anatomy-error');if(!el)return;const reason=this.lastDisplayError||this.lastGeometryError;el.hidden=!reason||!this.graphicsEnabled;el.textContent=reason?this.t('3D display failed: {reason} Use Retry display resources.',{reason:this.t(reason)}):'';}
  async retryDisplay(){
    if(!this.graphicsEnabled)return;
    const camera=this.scene?.snapshotCamera()||this.failedCamera;
    if(this.fallback){this.fallback=false;this.initScene();}
    const scene=this.scene;if(!scene)return;
    await scene.ready;if(this.scene!==scene)return;
    scene.geometryKey=null;if(this.trace)await scene.setTrace(this.trace);else if(scene.cells)await scene.setCells(scene.cells,scene.edges);if(this.scene!==scene)return;
    if(camera)Object.assign(scene,camera);
    $('anatomy-stage').hidden=false;this.canvas.hidden=true;
    this.lastDisplayError=null;this.lastGeometryError=scene.geometryErrors?scene.geometryFailure:null;this.displayError();
    if(this.frame)this.draw(this.frame);else{scene.draw();$('anatomy-state').textContent=this.t('Real anatomy · model propagation');}
  }
  geometryError(e){if(e.name==='AbortError')return;this.lastGeometryError=e.message;$('anatomy-state').textContent=this.t('Morphology loading failed; retry display resources.');this.displayError();}
  hide(){this.replay.suspend('invisible');}
  setVisible(visible){this.visible=visible;if(this.scene)this.scene.visible=visible&&this.graphicsEnabled;if(!visible)this.hide();else{this.replay.resume('invisible');if(this.frame)this.draw(this.frame);}}
  dispose(){clearInterval(this.scheduleCheck);this.scene?.dispose();this.replay.dispose();this.resize.disconnect();this.motion.removeEventListener('change',this.motionChange);}
}
