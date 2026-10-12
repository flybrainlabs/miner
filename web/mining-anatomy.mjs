import {THREE} from './anatomy-renderer.mjs';
import { AnatomyScene } from './anatomy-scene.mjs';
import { anatomyAssets, validateAnatomyIndex } from './anatomy-assets.mjs';
import { compileMorphology, buildMorphologyRoute, sampleRoute } from './propagation-routes.mjs';
import { NeuralRibbon } from './neural-ribbon.mjs';
import { MINING_ANATOMY_INDEX_SHA256 } from './mining-anatomy-index.mjs';
const $=id=>document.getElementById(id);
export function pulseFraction(time,event){return Math.max(0,Math.min(1,(time-event[4])/(event[5]-event[4])));}
export function spikeGlow(time,emitted){const age=time-emitted;return age<0||age>2?0:(1-Math.exp(-age*24))*Math.exp(-age*2.4);}
export class MiningAnatomy extends AnatomyScene {
  constructor(host,{config,t=s=>s,onSelect=()=>{},onFailure=()=>{},onInteract=()=>{}}={}){
    super(host,{antialias:true,pixelRatioMax:1.5});Object.assign(this,{config,t,onSelect,onFailure,onInteract});this.whole=true;this.onContextLost=()=>onFailure(new Error('WebGL context lost'));this.onVisible=()=>{if(this.initialFitPending&&this.host.clientWidth)this.frameBrain(this.whole);if(this.lastTraceFrame)this.update(this.lastTraceFrame,this.lastView);else this.draw();};this.generation=0;this.geometries=[];this.located=new Map();this.edgePaths=new Map();this.renderSamples=[];this.frameSamples=[];this.renderCount=0;this.qualityCounter=0;this.pointScratch={x:0,y:0,z:0,alpha:1};this.morphologies=new Map();
    this.dynamic=new THREE.Group();this.content.add(this.dynamic);this.background=new THREE.Group();this.content.add(this.background);
    this.ray=new THREE.Raycaster();this.ray.params.Points.threshold=.022;this.ray.params.Line.threshold=.01;this.clickStart=null;
    const signal=this.events.signal;
    host.addEventListener('pointerdown',e=>this.clickStart=[e.clientX,e.clientY],{signal});
    host.addEventListener('pointerup',e=>{if(!this.clickStart||Math.hypot(e.clientX-this.clickStart[0],e.clientY-this.clickStart[1])>6)return;this.pick(e);},{signal});
    $('anatomy-overview').onclick=()=>{this.onInteract();this.frameBrain(false);};$('anatomy-whole').onclick=()=>{this.onInteract();this.frameBrain(true);};$('anatomy-focus').onclick=()=>{this.onInteract();this.focus();};$('anatomy-reset').onclick=()=>{this.onInteract();this.panX=0;this.panY=0;this.yaw=.35;this.pitch=.08;this.frameBrain(true);};
    $('anatomy-fullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else host.parentElement.requestFullscreen?.();};
    this.ready=this.initialise().catch(e=>{if(e.name!=='AbortError')onFailure(e);});
  }
  async initialise(){
    this.assetAbort=new AbortController();const signal=this.assetAbort.signal;
    this.assetIndex=validateAnatomyIndex(await anatomyAssets.get('/assets/data/mining-anatomy.json',MINING_ANATOMY_INDEX_SHA256,signal),this.config);
    await this.loadAnatomy(await anatomyAssets.get(this.assetIndex.context.path,this.assetIndex.context.sha256,signal));if(!this.alive)return;
    this.frameBrain(true);this.host.dataset.stage='3d';this.host.dataset.dataset=this.assetIndex.dataset;
    const targets=this.assetIndex.cells.filter(c=>this.config.target_body_ids.includes(Number(c.body_id)));
    await this.setCells(targets.map(c=>({index:c.model_index,bodyId:c.body_id,stimulus:true})),[]);
    this.draw();

  }
  frameBrain(whole){if(!this.context)return;this.whole=whole;if(!this.host.clientWidth||!this.host.clientHeight){this.initialFitPending=true;return;}this.initialFitPending=false;const box=new THREE.Box3();for(const m of this.outlines.children){m.visible=whole||m.name!=='vnc';if(m.visible)box.union(m.geometry.boundingBox);}this.framingBounds=box;this.content.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-1);this.baseDistance=this.framingDistance(box);this.zoom=1;this.panX=0;this.panY=0;this.host.dataset.framing=whole?'whole-cns':'brain';this.draw();}
  framingDistance(box){
    // Bound every yaw around the same anatomical center, including the lower
    // nerve cord. Portrait/fullscreen resize changes distance, not that pivot.
    const half=box.getSize(new THREE.Vector3()).multiplyScalar(.5),radial=Math.hypot(half.x,half.z),c=Math.abs(Math.cos(this.pitch)),s=Math.abs(Math.sin(this.pitch));
    const tanY=Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2)),tanX=tanY*Math.max(.1,this.camera.aspect);
    return Math.max(.1,radial*c+half.y*s+Math.max(radial/tanX,(half.y*c+radial*s)/tanY)*1.08);
  }
  // Retain user rotation, zoom and pan, but refit the chosen bounds on resize.
  fit(preserve=false){if(preserve&&this.context){if(this.framingBounds)this.baseDistance=this.framingDistance(this.framingBounds);this.draw();return;}super.fit(preserve);}
  focus(){const p=this.located.get(this.selectedCell??this.cells?.find(c=>c.stimulus)?.index);if(!p)return;this.framingBounds=null;this.host.dataset.framing='focus';this.content.position.copy(p).multiplyScalar(-1);this.baseDistance=1.2;this.zoom=1;this.panX=0;this.panY=0;this.draw();}
  async setTrace(trace){await this.ready;if(!this.alive||!this.context)return;await this.setCells(trace?.cells||[],trace?.edges||[]);}
  async setCells(cells,edges){
    const key=JSON.stringify([cells.map(c=>[c.index,c.bodyId]),edges.map(e=>[e.edgeId,e.sourceIndex,e.targetIndex,e.signedCurrent])]);
    if(key===this.geometryKey&&!this.loadingGeometry)return;
    const generation=++this.generation;this.geometryAbort?.abort();const abort=this.geometryAbort=new AbortController();this.cells=cells;this.edges=edges;this.clearDynamic();this.located=new Map();this.edgePaths=new Map();this.morphologies=new Map();this.loadingGeometry=true;this.geometryErrors=0;
    this.host.dataset.geometry='loading';
    const entries=cells.map(c=>({cell:c,asset:this.assetIndex.cells.find(a=>a.body_id===c.bodyId&&a.model_index===c.index)}));
    await Promise.all(entries.map(async({cell,asset})=>{
      if(!asset)return;
      try{
        const topology=await anatomyAssets.topology(asset,this.config,abort.signal);if(generation!==this.generation||abort.signal.aborted||!this.alive)return;
        const compiled=compileMorphology(topology,this.context,this.quality==='low'?2:this.quality==='high'?0:1);this.morphologies.set(cell.index,compiled);
        const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(compiled.background,3));const m=new THREE.LineBasicMaterial({color:cell.stimulus?'#dddddd':'#888888',transparent:true,opacity:cell.stimulus?.42:.18,depthWrite:false});const mesh=new THREE.LineSegments(g,m);mesh.userData.cellIndex=cell.index;this.dynamic.add(mesh);this.geometries.push({g,m,mesh,cellIndex:cell.index});
        this.located.set(cell.index,new THREE.Vector3().fromArray(compiled.displayOrigin));
      }catch(e){if(e.name!=='AbortError'){this.geometryErrors++;this.geometryFailure=e.message;}}
    }));
    if(generation!==this.generation||!this.alive)return;this.loadingGeometry=false;this.geometryKey=key;this.mappedCount=this.located.size;this.unlocated=cells.length-this.mappedCount;
    this.buildLayers();this.host.dataset.geometry=this.geometryErrors?'partial-error':'ready';this.host.dataset.located=String(this.mappedCount);this.host.dataset.unlocated=String(this.unlocated);
    if(this.lastTraceFrame)this.update(this.lastTraceFrame,this.lastView);else this.draw();
  }
  async setQuality(quality){if(!['low','normal','high'].includes(quality))throw new Error('Display quality');this.quality=quality;this.geometryKey=null;if(this.cells)await this.setCells(this.cells,this.edges);}
  buildLayers(){
    for(const edge of this.edges){const route=buildMorphologyRoute(edge,this.morphologies.get(edge.sourceIndex),this.morphologies.get(edge.targetIndex),this.config.graph_sha256);this.edgePaths.set(edge.edgeId,route);}
    this.ribbon=new NeuralRibbon(this.dynamic,{maxRoutes:this.quality==='low'?32:96});
    if(this.autoQualityStage>=2)this.ribbon.halo.visible=false;
  }
  clearActivity(){this.lastTraceFrame=null;this.lastView=null;this.activeDraw=false;this.ribbon?.clear();for(const x of this.geometries)if(x.cellIndex!=null)x.m.opacity=.18;this.draw();}
  update(frame,view){
    this.lastTraceFrame=frame;this.lastView=view;if(!this.ribbon||!this.visible||document.hidden)return;
    const activities=frame.activities||[...frame.moving.map(event=>({event,phase:'emit',progress:pulseFraction(view.time,event),strength:1})),...frame.arrived.map(event=>({event,phase:'arrival',progress:frame.fraction,strength:.6}))];
    for(const x of this.geometries)if(x.cellIndex!=null){const state=frame.states.find(s=>s.cell.index===x.cellIndex),fired=state?.lanes.some(l=>l.row?.[3]);x.m.opacity=fired?.65:x.cellIndex===this.selectedCell?.42:.18;}
    this.ribbon.viewport(this.renderer);this.ribbon.update(activities,this.edgePaths,view.reduced);this.pulseCount=this.ribbon.routeCount;this.arrivalCount=activities.filter(e=>e.phase==='arrival').length;this.renderParticles=0;this.spikeGlowCount=0;this.activeDraw=activities.length>0;this.draw();
  }
  pick(event){if(!this.cells?.length)return;const rect=this.host.getBoundingClientRect();this.ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),this.camera);this.group.updateMatrixWorld(true);const hit=this.ray.intersectObjects(this.dynamic.children.filter(o=>o.userData.cellIndex!=null||o.userData.edgeSegments),false)[0];if(!hit)return;
    if(hit.object.userData.cellIndex!=null){this.selectedCell=hit.object.userData.cellIndex;this.onSelect({type:'cell',index:this.selectedCell});}
    else if(hit.object.userData.edgeSegments){const id=hit.object.userData.edgeSegments[Math.floor(hit.index/2)];if(id!=null)this.onSelect({type:'edge',index:id});}
  }
  draw(){
    const at=performance.now();super.draw();if(!this.renderSamples||!this.visible||document.hidden)return;
    this.renderCount++;this.lastRenderAt=at;if(this.activeDraw&&this.lastDrawActive&&this.lastFrameAt!=null){const dt=at-this.lastFrameAt;if(dt>0&&dt<500){this.frameSamples.push(dt);if(this.frameSamples.length>120)this.frameSamples.shift();}}this.lastFrameAt=at;this.lastDrawActive=!!this.activeDraw;
    // Frame intervals include GPU presentation scheduling and interaction draws;
    // no FPS promise is inferred from the synchronous render() call duration.
    if(this.activeDraw&&++this.qualityCounter>=60){this.qualityCounter=0;const intervals=this.frameSamples.slice(-60);const mean=intervals.reduce((a,b)=>a+b,0)/Math.max(1,intervals.length);if(intervals.length===60&&mean>100&&!this.softwareRenderer){this.slowWindows=(this.slowWindows||0)+1;if(this.slowWindows>=3){const stage=this.autoQualityStage||0;if(stage===0){this.ribbon.maxRoutes=32;}else if(stage===1){this.ribbon.halo.visible=false;}else if(stage===2){this.setQuality('low').catch(e=>this.onFailure(e));}else if(this.renderer.getPixelRatio()>.8){this.renderer.setPixelRatio(Math.max(.8,this.renderer.getPixelRatio()*.9));}this.autoQualityStage=Math.min(4,stage+1);this.slowWindows=0;}}else this.slowWindows=0;}
  }
  snapshot(){return {mode:this.contextLost?'context-lost':'3d',renderer:this.renderer.domElement.dataset.renderer,rendererRevision:THREE.REVISION,antialias:this.renderer.getContext().getContextAttributes()?.antialias,visible:this.visible,routeVisible:this.routeVisible,onScreen:this.onScreen,viewTime:this.lastView?.time,recordedMoving:this.lastTraceFrame?.moving?.length||0,recordedArrivals:this.lastTraceFrame?.arrived?.length||0,camera:this.snapshotCamera(),located:this.mappedCount||0,unlocated:this.unlocated||0,geometryErrors:this.geometryErrors||0,backgroundSamples:this.backgroundSampleCount||0,particles:this.pulseCount||0,arrivals:this.arrivalCount||0,renderParticles:this.renderParticles||0,glows:this.spikeGlowCount||0,ribbon:this.ribbon?.snapshot(),geometryCount:this.geometries.length,assetCacheBytes:anatomyAssets.bytes,routeMode:'morphology-guided',mappedSynapsePairs:0,geometryGeneration:this.generation,geometryLoading:this.loadingGeometry,geometryState:this.host.dataset.geometry,lastRenderAt:this.lastRenderAt,renderCount:this.renderCount,frameIntervalMs:this.frameSamples?.length?this.frameSamples.reduce((a,b)=>a+b,0)/this.frameSamples.length:null};}
  clearDynamic(){this.ribbon?.dispose();this.ribbon=null;for(const x of this.geometries){this.dynamic.remove(x.mesh);x.g.dispose();x.m.dispose();}this.geometries=[];this.nodes=null;}
  dispose(){this.generation++;this.assetAbort?.abort();this.geometryAbort?.abort();this.clearDynamic();for(const p of this.background.children){p.geometry.dispose();p.material.dispose();}super.dispose();}
}
