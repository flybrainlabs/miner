import {THREE,createAnatomyRenderer} from './anatomy-renderer.mjs';
import {validateAnatomy,anatomyPositions,skeletonInAnatomy} from "./atlas-core.js";
export class AnatomyScene {
  constructor(host,{antialias=true,pixelRatioMax=1.5}={}){
    this.host=host;this.alive=true;this._auto=false;this.panX=0;this.panY=0;this.dragging=false;this.yaw=.35;this.pitch=.08;this.zoom=1;this.points=new Map();this.visible=true;this.mode="context";this.outlineVisible=true;this.outlineOpacity=.3;this.baseDistance=3.9;this.context=null;this.contextResources=[];
    this.renderer=createAnatomyRenderer({antialias});this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,pixelRatioMax));
    const gl=this.renderer.getContext(),rendererInfo=gl.getExtension('WEBGL_debug_renderer_info');
    this.softwareRenderer=!!rendererInfo&&/SwiftShader|llvmpipe|Software/i.test(gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL));
    if(this.softwareRenderer)this.renderer.setPixelRatio(Math.min(this.renderer.getPixelRatio(),.65));
    this.renderer.domElement.setAttribute("aria-hidden","true");this.renderer.domElement.addEventListener("webglcontextlost",e=>{e.preventDefault();this.contextLost=true;if(this.alive)this.onContextLost?.();});host.append(this.renderer.domElement);
    this.scene=new THREE.Scene();this.group=new THREE.Group();this.content=new THREE.Group();this.outlines=new THREE.Group();this.content.add(this.outlines);this.group.add(this.content);this.scene.add(this.group);this.camera=new THREE.PerspectiveCamera(37,1,.01,100);
    this.resize=new ResizeObserver(()=>{this.renderer.setSize(host.clientWidth,host.clientHeight);this.camera.aspect=Math.max(.1,host.clientWidth/Math.max(1,host.clientHeight)||1);this.camera.updateProjectionMatrix();this.fit(true);});this.resize.observe(host);
    this.onScreen=true;
    this.intersection=new IntersectionObserver(es=>{const wasVisible=this.visible;this.onScreen=es[0].isIntersecting;this.onScreenChange?.(this.onScreen);if(this.visible&&!wasVisible){if(this.onVisible)this.onVisible();else this.draw();}});this.intersection.observe(host);
    this.events=new AbortController();const opt={signal:this.events.signal};
    host.addEventListener("pointerdown",e=>{if(e.pointerType==="mouse"&&![0,2].includes(e.button))return;this.onInteract?.();this.panning=e.shiftKey||e.button===2;host.setPointerCapture(e.pointerId);this.points.set(e.pointerId,[e.clientX,e.clientY]);this.dragging=true;this.last=[e.clientX,e.clientY];this.pinch=this.distance();},opt);
    host.addEventListener("pointermove",e=>{if(!this.points.has(e.pointerId))return;this.points.set(e.pointerId,[e.clientX,e.clientY]);if(this.points.size===2){const d=this.distance();if(d&&this.pinch)this.zoom=THREE.MathUtils.clamp(this.zoom*this.pinch/d,.45,2.5);this.pinch=d;}else if(this.panning){this.panX+=(e.clientX-this.last[0])/Math.max(1,host.clientWidth)*this.baseDistance;this.panY-=(e.clientY-this.last[1])/Math.max(1,host.clientHeight)*this.baseDistance;}else{this.yaw+=(e.clientX-this.last[0])*.008;this.pitch=THREE.MathUtils.clamp(this.pitch+(e.clientY-this.last[1])*.008,-1.5,1.5);}this.last=[e.clientX,e.clientY];this.draw();},opt);
    const release=e=>{this.points.delete(e.pointerId);this.dragging=this.points.size>0;this.pinch=this.distance();if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);};
    host.addEventListener("pointerup",release,opt);host.addEventListener("pointercancel",release,opt);host.addEventListener("lostpointercapture",release,opt);
    host.addEventListener("contextmenu",e=>e.preventDefault(),opt);host.addEventListener("wheel",e=>{this.onInteract?.();e.preventDefault();this.zoom=THREE.MathUtils.clamp(this.zoom*Math.exp(e.deltaY*.001),.45,2.5);this.draw();},{...opt,passive:false});
    host.addEventListener("keydown",e=>{if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","+","-","="].includes(e.key))return;e.preventDefault();this.onInteract?.();if(e.key==="ArrowLeft")this.yaw-=.15;if(e.key==="ArrowRight")this.yaw+=.15;if(e.key==="ArrowUp")this.pitch-=.12;if(e.key==="ArrowDown")this.pitch+=.12;if(e.key==="+"||e.key==="=")this.zoom=Math.max(.45,this.zoom-.1);if(e.key==="-")this.zoom=Math.min(2.5,this.zoom+.1);this.draw();},opt);
    
  }
  get auto(){return this._auto;}
  get visible(){return this.routeVisible!==false&&this.onScreen!==false;}
  set visible(value){this.routeVisible=!!value;}
  set auto(value){this._auto=!!value;cancelAnimationFrame(this.frame);if(!this._auto)return;let last=performance.now();const run=now=>{if(!this.alive||!this._auto)return;if(this.visible&&!document.hidden&&!this.dragging){this.yaw+=Math.min(.05,Math.max(0,now-last)/1000)*.25;this.draw();}last=now;this.frame=requestAnimationFrame(run);};this.frame=requestAnimationFrame(run);}
  snapshotCamera(){return {yaw:this.yaw,pitch:this.pitch,zoom:this.zoom,panX:this.panX,panY:this.panY,baseDistance:this.baseDistance};}
  async loadAnatomy(contextData=null){
    if(this.context)return true;
    let context=contextData;if(!context){const response=await fetch("/assets/data/atlas-context.json",{signal:this.events.signal});if(!response.ok)throw new Error("Anatomical outline unavailable");context=await response.json();}context=validateAnatomy(context);if(!this.alive)return false;
    this.context=context;this.contextBounds=new THREE.Box3();
    for(const part of context.parts){
      const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.BufferAttribute(anatomyPositions(part.positions,context),3));geometry.setIndex(part.indices);geometry.computeVertexNormals();geometry.computeBoundingBox();this.contextBounds.union(geometry.boundingBox);
      const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{opacity:{value:this.outlineOpacity}},
        vertexShader:"varying vec3 surfaceNormal; varying vec3 viewDirection; void main(){vec4 p=modelViewMatrix*vec4(position,1.0);surfaceNormal=normalize(normalMatrix*normal);viewDirection=-p.xyz;gl_Position=projectionMatrix*p;}",
        fragmentShader:"uniform float opacity; varying vec3 surfaceNormal; varying vec3 viewDirection; void main(){float rim=pow(1.0-abs(dot(normalize(surfaceNormal),normalize(viewDirection))),2.5);gl_FragColor=vec4(vec3(0.78),opacity*(0.035+0.965*rim));}"});
      const mesh=new THREE.Mesh(geometry,material);mesh.name=part.key;mesh.renderOrder=0;this.outlines.add(mesh);this.contextResources.push({geometry,material});
    }
    this.outlines.visible=this.outlineVisible;this.host.dataset.contextReady="true";this.fit(false);return true;
  }
  distance(){const p=[...this.points.values()];return p.length===2?Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]):0;}
  set(data){const preserve=this.mode==="context"&&!!this.neuronBounds;this.clear();this.geometry=new THREE.BufferGeometry();const positions=this.context?skeletonInAnatomy(data,this.context):new Float32Array(data.positions);this.geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));this.geometry.computeBoundingBox();this.neuronBounds=this.geometry.boundingBox.clone();this.material=new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:1,depthTest:false});this.lines=new THREE.LineSegments(this.geometry,this.material);this.lines.renderOrder=2;this.content.add(this.lines);this.fit(preserve);this.host.dataset.bodyId=data.body_id;this.host.dataset.ready="true";this.host.dataset.loading="false";}
  beginLoad(){if(this.lines)this.lines.visible=false;this.host.dataset.ready="false";this.host.dataset.loading="true";delete this.host.dataset.bodyId;this.draw();}
  setMode(mode){this.mode=mode==="neuron"?"neuron":"context";this.host.dataset.viewMode=this.mode;this.fit(false);}
  setOutlineVisible(value){this.outlineVisible=!!value;this.outlines.visible=this.outlineVisible;this.draw();}
  setOutlineOpacity(value){this.outlineOpacity=THREE.MathUtils.clamp(Number(value)||0,0,.6);for(const item of this.contextResources)item.material.uniforms.opacity.value=this.outlineOpacity;this.draw();}
  fit(preserveZoom=false){
    const box=this.mode==="neuron"&&this.neuronBounds?this.neuronBounds.clone():this.contextBounds?.clone()||this.neuronBounds?.clone();
    if(box){if(this.mode==="context"&&this.neuronBounds)box.union(this.neuronBounds);const center=box.getCenter(new THREE.Vector3()),sphere=box.getBoundingSphere(new THREE.Sphere());this.content.position.copy(center).multiplyScalar(-1);const fov=2*Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))*Math.min(1,this.camera.aspect));this.baseDistance=Math.max(.1,sphere.radius)/Math.sin(fov/2)*1.08;}
    if(!preserveZoom)this.zoom=1;this.draw();
  }
  reset(){this.yaw=.35;this.pitch=.08;this.panX=0;this.panY=0;this.fit(false);}
  draw(){if(!this.alive)return;this.group.rotation.set(this.pitch,this.yaw,0);this.camera.position.set(0,0,this.baseDistance*this.zoom);this.camera.lookAt(0,0,0);this.group.position.set(this.panX,this.panY,0);if(this.visible&&!document.hidden&&!this.contextLost)this.renderer.render(this.scene,this.camera);}
  clear(){if(this.lines)this.content.remove(this.lines);this.geometry?.dispose();this.material?.dispose();this.lines=null;this.host.dataset.ready="false";delete this.host.dataset.bodyId;}
  dispose(){this.alive=false;this.clear();for(const item of this.contextResources){item.geometry.dispose();item.material.dispose();}this.contextResources=[];cancelAnimationFrame(this.frame);this.resize.disconnect();this.intersection.disconnect();this.events.abort();this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();}
}
