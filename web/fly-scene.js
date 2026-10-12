import * as THREE from "./vendor/three/three.module.min.js";

const host=document.getElementById("fly-viewport");
const fallback=document.getElementById("fly-fallback");
const pauseButton=document.getElementById("fly-pause");
const wireButton=document.getElementById("fly-wireframe");
const coordinate=document.getElementById("fly-coordinate");
const partLabel=document.getElementById("specimen-part");
const caption=document.getElementById("specimen-caption");
const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;

try {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"low-power"});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.6));
  renderer.setClearColor(0x070707,0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.65;
  renderer.domElement.setAttribute("aria-hidden","true");
  renderer.domElement.dataset.renderer="three-webgl";
  host.appendChild(renderer.domElement);

  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(34,1,0.1,100);
  const baseCamera=new THREE.Vector3(4.2,3.1,-8.1);
  camera.position.copy(baseCamera);
  camera.lookAt(0,0,0.35);
  scene.add(new THREE.AmbientLight(0xffffff,0.8));
  const key=new THREE.DirectionalLight(0xffffff,5.0);key.position.set(-4,6,-4);scene.add(key);
  const rim=new THREE.DirectionalLight(0xffffff,4.5);rim.position.set(4,2,4);scene.add(rim);
  const fill=new THREE.DirectionalLight(0xffffff,1.8);fill.position.set(0,-2,-3);scene.add(fill);

  // A neutral studio environment supplies grayscale reflections. It is not a
  // downloaded HDR image or a simulated scientific reconstruction.
  const studio=new THREE.Scene();studio.background=new THREE.Color(0x484848);
  const panels=[
    [[-4,4,0],[0,0,0],5,8,4.0],
    [[4,1,-2],[0,0,0],3,8,2.5],
    [[0,5,2],[0,0,0],7,4,3.0],
  ];
  for(const [position,target,width,height,power] of panels){
    const panel=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({color:new THREE.Color(power,power,power),side:THREE.DoubleSide}));
    panel.position.set(...position);panel.lookAt(...target);studio.add(panel);
  }
  const pmrem=new THREE.PMREMGenerator(renderer);
  const environment=pmrem.fromScene(studio,0.025);
  scene.environment=environment.texture;pmrem.dispose();
  studio.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});

  const root=new THREE.Group();root.position.y=0.12;scene.add(root);
  const model=new THREE.Group();model.rotation.set(0.05,0.42,0.08);root.add(model);
  const shellMat=new THREE.MeshStandardMaterial({color:0x4d4d4d,metalness:0.83,roughness:0.39});
  const darkMat=new THREE.MeshStandardMaterial({color:0x171717,metalness:0.7,roughness:0.36});
  const eyeMat=new THREE.MeshStandardMaterial({color:0x353535,metalness:0.86,roughness:0.25});
  const seamMat=new THREE.LineBasicMaterial({color:0xb8b8b8,transparent:true,opacity:0.25});
  const veinMat=new THREE.LineBasicMaterial({color:0xe3e3e3,transparent:true,opacity:0.43});
  const hairMat=new THREE.LineBasicMaterial({color:0xbcbcbc,transparent:true,opacity:0.42});
  const bodyMaterials=[shellMat,darkMat,eyeMat];
  const pickable=[];
  const wingGroups=[];
  const flyParts={head:"复眼与头部",thorax:"胸部 · 六足与翅的连接",abdomen:"分节腹部",wing:"翅膜与翅脉",legs:"三对分节足",antenna:"触角"};
  function mesh(geometry,material,parent=model,label){
    const item=new THREE.Mesh(geometry,material);parent.add(item);
    if(label){item.userData.part=label;pickable.push(item);}return item;
  }
  function ellipsoid(position,scale,material,label,parent=model){
    const item=mesh(new THREE.SphereGeometry(1,48,32),material,parent,label);
    item.position.set(...position);item.scale.set(...scale);return item;
  }
  function line(points,material=veinMat,parent=model){
    const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
    const obj=new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(60)),material);parent.add(obj);return obj;
  }
  function rod(a,b,radius,material=darkMat,parent=model){
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),direction=end.clone().sub(start);
    const obj=mesh(new THREE.CylinderGeometry(radius*0.68,radius,direction.length(),10),material,parent,"legs");
    obj.position.copy(start.add(end).multiplyScalar(0.5));
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());return obj;
  }
  ellipsoid([0,0,0],[0.52,0.49,0.67],shellMat,"thorax");
  ellipsoid([0,-0.25,0.01],[0.37,0.28,0.52],darkMat,"thorax");
  ellipsoid([0,0.04,-0.78],[0.46,0.38,0.35],shellMat,"head");
  ellipsoid([0,-0.14,-1.045],[0.15,0.13,0.14],darkMat,"head");

  const rings=[[0.36,0.44],[0.43,0.67],[0.45,0.94],[0.43,1.19],[0.36,1.43],[0.27,1.64],[0.15,1.81],[0.015,1.92]];
  const abdomenGeometry=new THREE.LatheGeometry(rings.map(([r,z])=>new THREE.Vector2(r,z)),64);
  const abdomen=mesh(abdomenGeometry,shellMat,model,"abdomen");
  abdomen.rotation.x=Math.PI/2;abdomen.scale.z=0.79;abdomen.position.y=-0.06;
  for(let i=1;i<rings.length-1;i++){
    const [r,z]=rings[i],pts=[];
    for(let j=0;j<=96;j++){const a=j/96*Math.PI*2;pts.push(new THREE.Vector3(Math.cos(a)*r,-0.06+Math.sin(a)*r*0.8,z));}
    const material=new THREE.LineBasicMaterial({color:i%2?0x161616:0xc4c4c4,transparent:true,opacity:i%2?0.8:0.28});
    model.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),material));
  }

  for(const side of [-1,1]){
    const eye=ellipsoid([side*0.355,0.095,-0.82],[0.275,0.335,0.285],eyeMat,"head");
    eye.rotation.z=side*-0.15;
    const facets=[];
    // Fibonacci facets indicate compound-eye structure without colored eyes.
    for(let i=0;i<560;i++){
      const t=(i+0.5)/560,az=i*2.399963229728653,cos=0.06+t*0.94,sin=Math.sqrt(1-cos*cos);
      facets.push(side*cos*0.278,Math.cos(az)*sin*0.337,Math.sin(az)*sin*0.288);
    }
    const eyePoints=new THREE.Points(new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(facets,3)),new THREE.PointsMaterial({color:0xe0e0e0,size:0.011,transparent:true,opacity:0.43,sizeAttenuation:true}));
    eyePoints.position.copy(eye.position);eyePoints.rotation.copy(eye.rotation);model.add(eyePoints);
    ellipsoid([side*0.125,0.19,-1.075],[0.045,0.04,0.075],darkMat,"antenna");
    line([[side*0.12,0.22,-1.08],[side*0.19,0.3,-1.26],[side*0.26,0.32,-1.33]],hairMat);
    for(let i=0;i<5;i++){
      const z=-1.13-i*0.036,x=side*(0.15+i*0.018);
      line([[x,0.25+i*0.013,z],[x+side*0.052,0.31+i*0.015,z-0.025]],hairMat);
    }

    // One wing pair, three leg pairs and a pair of halteres identify a fly.
    const wingGroup=new THREE.Group();wingGroup.position.set(side*0.29,0.23,0.02);wingGroup.scale.x=side;model.add(wingGroup);wingGroups.push({group:wingGroup,side});
    const shape=new THREE.Shape();shape.moveTo(0,0);shape.bezierCurveTo(0.43,-0.24,1.78,-0.2,2.23,0.15);shape.bezierCurveTo(2.78,0.65,2.32,1.43,1.6,1.42);shape.bezierCurveTo(0.91,1.42,0.39,0.51,0,0);
    const wingGeo=new THREE.ShapeGeometry(shape,48);wingGeo.rotateX(Math.PI/2);
    const wingMat=new THREE.MeshPhysicalMaterial({color:0xdddddd,metalness:0.15,roughness:0.24,transparent:true,opacity:0.15,side:THREE.DoubleSide,depthWrite:false});
    mesh(wingGeo,wingMat,wingGroup,"wing");
    const outline=shape.getPoints(150).map(v=>new THREE.Vector3(v.x,0,v.y));
    wingGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline),new THREE.LineBasicMaterial({color:0xededed,transparent:true,opacity:0.55})));
    const veins=[
      [[0,0,0],[0.75,0,0.05],[1.55,0,0.08],[2.18,0,0.18]],
      [[0,0,0],[0.63,0,0.22],[1.36,0,0.47],[2.44,0,0.57]],
      [[0.06,0,0.04],[0.6,0,0.39],[1.12,0,0.82],[2.12,0,1.18]],
      [[0.03,0,0.04],[0.44,0,0.45],[0.82,0,0.89],[1.61,0,1.39]],
      [[0.65,0,0.23],[0.64,0,0.43],[0.55,0,0.61]],
      [[1.38,0,0.46],[1.29,0,0.68],[1.21,0,0.85]],
    ];
    veins.forEach(v=>line(v,veinMat,wingGroup));
    // Fine microstructure, subordinate to the anatomical wing veins.
    const speckles=[];
    for(let i=0;i<340;i++){
      const a=i*2.39996,r=Math.sqrt((i+0.5)/340),x=1.3+Math.cos(a)*0.75*r,z=0.59+Math.sin(a)*0.46*r;
      speckles.push(x,0.003,z);
    }
    wingGroup.add(new THREE.Points(new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(speckles,3)),new THREE.PointsMaterial({color:0xffffff,size:0.006,transparent:true,opacity:0.23})));
    wingGroup.rotation.z=side*-0.075;
    for(let leg=0;leg<3;leg++){
      const z=-0.3+leg*0.36;
      const kneeZ=z+(leg-1)*0.38;
      const a=[side*0.32,-0.26,z],b=[side*(0.67+leg*0.06),-0.43,kneeZ],c=[side*(0.95+leg*0.055),-0.88,kneeZ+(leg-1)*0.24],d=[side*(1.2+leg*0.015),-1.0,kneeZ+(leg-1)*0.46];
      rod(a,b,0.045,shellMat);rod(b,c,0.029,shellMat);rod(c,d,0.018,darkMat);
      ellipsoid(b,[0.042,0.042,0.042],shellMat,"legs");
      line([d,[d[0]+side*0.055,d[1]-0.005,d[2]+0.1],[d[0]+side*0.028,d[1]-0.04,d[2]+0.145]],hairMat);
      for(let j=1;j<=4;j++){
        const t=j/5,p=b.map((v,k)=>v+(c[k]-v)*t),q=[p[0]+side*0.075,p[1]+0.015,p[2]+0.035];
        line([p,q],hairMat);
      }
    }
    const haltereStem=[side*0.52,-0.025,0.6],haltereEnd=[side*0.73,0.08,0.83];
    rod(haltereStem,haltereEnd,0.015,darkMat);
    ellipsoid(haltereEnd,[0.068,0.044,0.072],shellMat,"thorax");
  }

  const bristles=[];
  for(let i=0;i<70;i++){
    const az=i*2.39996,y=0.18+0.8*(i+0.5)/70,r=Math.sqrt(1-y*y),x=Math.cos(az)*r,z=Math.sin(az)*r;
    const start=[x*0.526,y*0.492,z*0.675],end=[start[0]+x*0.07,start[1]+y*0.065,start[2]+z*0.07];
    bristles.push(...start,...end);
  }
  model.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(bristles,3)),hairMat));

  // Quiet orbital guides frame the specimen; they are not connectome edges.
  const orbit=new THREE.Group();scene.add(orbit);
  const circle=[];
  for(let i=0;i<=180;i++){const a=i/180*Math.PI*2;circle.push(new THREE.Vector3(Math.cos(a)*3.05,-0.4,Math.sin(a)*3.05));}
  orbit.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circle),new THREE.LineBasicMaterial({color:0x808080,transparent:true,opacity:0.12})));
  const ticks=[];
  for(let i=0;i<60;i++){const a=i/60*Math.PI*2,r1=3.1,r2=i%5===0?3.19:3.14;ticks.push(Math.cos(a)*r1,-0.4,Math.sin(a)*r1,Math.cos(a)*r2,-0.4,Math.sin(a)*r2);}
  orbit.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(ticks,3)),new THREE.LineBasicMaterial({color:0xaaaaaa,transparent:true,opacity:0.16})));

  const stars=[];
  for(let i=0;i<140;i++){
    const t=i*1.61803398875,a=i*2.39996;
    stars.push(Math.cos(a)*(3.1+(t%1)*1.1),Math.sin(t*2.3)*1.75,Math.sin(a)*(2.6+(t%1)));
  }
  const particles=new THREE.Points(new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(stars,3)),new THREE.PointsMaterial({color:0xeeeeee,size:0.011,transparent:true,opacity:0.38,depthWrite:false}));
  scene.add(particles);

  let paused=reduced,wireframe=false,visible=true,dragging=false,lastX=0,lastY=0;
  let targetYaw=0,targetPitch=0,yaw=0,pitch=0,targetZoom=1,zoom=1,lastTime=performance.now(),elapsed=0,frames=0,lastLabelTime=0,wasDragged=false;
  function paintInteraction(){
    yaw=targetYaw;pitch=targetPitch;zoom=targetZoom;
    root.rotation.y=yaw+Math.sin(elapsed*0.22)*0.1;root.rotation.x=pitch;
    camera.position.copy(baseCamera).multiplyScalar(zoom);camera.lookAt(0,0,0.35);
    renderer.render(scene,camera);
    coordinate.textContent="ROT. "+String(Math.round(yaw*180/Math.PI)).padStart(3,"0")+"° / "+(1/zoom).toFixed(2)+"×";
  }
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  const touches=new Map();let pinchDistance=0;
  pauseButton.textContent=paused?"播放":"暂停";pauseButton.setAttribute("aria-pressed",String(paused));
  function resize(){const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.aspect=w/Math.max(h,1);camera.updateProjectionMatrix();}
  const resizer=new ResizeObserver(resize);resizer.observe(host);resize();
  const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;},{threshold:0.02});observer.observe(host);
  host.addEventListener("pointerdown",event=>{
    if(event.pointerType==="mouse"&&event.button!==0)return;
    touches.set(event.pointerId,[event.clientX,event.clientY]);
    dragging=touches.size===1;wasDragged=false;lastX=event.clientX;lastY=event.clientY;host.setPointerCapture(event.pointerId);
    if(touches.size===2){const [a,b]=[...touches.values()];pinchDistance=Math.hypot(a[0]-b[0],a[1]-b[1]);}
  });
  host.addEventListener("pointermove",event=>{
    if(touches.has(event.pointerId))touches.set(event.pointerId,[event.clientX,event.clientY]);
    if(touches.size===2){
      const [a,b]=[...touches.values()],distance=Math.hypot(a[0]-b[0],a[1]-b[1]);
      if(distance>0&&pinchDistance>0)targetZoom=THREE.MathUtils.clamp(targetZoom*pinchDistance/distance,0.68,1.5);
      pinchDistance=distance;paintInteraction();return;
    }
    if(event.pointerType==="mouse"&&event.buttons===0)dragging=false;
    if(dragging){const dx=event.clientX-lastX,dy=event.clientY-lastY;targetYaw+=dx*0.006;targetPitch=THREE.MathUtils.clamp(targetPitch+dy*0.004,-0.85,0.85);wasDragged=wasDragged||Math.abs(dx)+Math.abs(dy)>3;lastX=event.clientX;lastY=event.clientY;paintInteraction();return;}
    const rect=host.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(pickable,false)[0];
    const part=hit?.object.userData.part;
    partLabel.textContent=part?part.toUpperCase():"DROSOPHILA";caption.textContent=part?flyParts[part]:"果蝇 · 三维结构示意";
  });
  const release=event=>{touches.delete(event.pointerId);dragging=false;pinchDistance=0;if(host.hasPointerCapture(event.pointerId))host.releasePointerCapture(event.pointerId);};
  host.addEventListener("pointerup",release);host.addEventListener("pointercancel",release);
  host.addEventListener("lostpointercapture",release);
  host.addEventListener("pointerleave",()=>{if(!dragging){partLabel.textContent="DROSOPHILA";caption.textContent="果蝇 · 三维结构示意";}});
  host.addEventListener("wheel",event=>{event.preventDefault();targetZoom=THREE.MathUtils.clamp(targetZoom+event.deltaY*0.0006,0.68,1.5);paintInteraction();},{passive:false});
  host.addEventListener("keydown",event=>{
    if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","+","-","="].includes(event.key))event.preventDefault();
    if(event.key==="ArrowLeft")targetYaw-=0.18;if(event.key==="ArrowRight")targetYaw+=0.18;
    if(event.key==="ArrowUp")targetPitch=Math.max(-0.85,targetPitch-0.1);if(event.key==="ArrowDown")targetPitch=Math.min(0.85,targetPitch+0.1);
    if(event.key==="+"||event.key==="=")targetZoom=Math.max(0.68,targetZoom-0.1);if(event.key==="-")targetZoom=Math.min(1.5,targetZoom+0.1);
    paintInteraction();
  });
  pauseButton.addEventListener("click",()=>{paused=!paused;pauseButton.textContent=paused?"播放":"暂停";pauseButton.setAttribute("aria-pressed",String(paused));});
  wireButton.addEventListener("click",()=>{wireframe=!wireframe;wireButton.setAttribute("aria-pressed",String(wireframe));bodyMaterials.forEach(material=>{material.wireframe=wireframe;material.color.setHex(wireframe?0x939393:material===shellMat?0x4d4d4d:material===darkMat?0x171717:0x353535);});paintInteraction();});
  document.getElementById("fly-reset").addEventListener("click",()=>{targetYaw=0;targetPitch=0;targetZoom=1;paintInteraction();});
  fallback.hidden=true;host.dataset.ready="true";host.dataset.engine="Three.js r180";
  if(window.matchMedia("(pointer: coarse)").matches)document.querySelector(".interaction-hint").textContent="拖动旋转 · 双指缩放";
  function frame(now){
    const delta=Math.min((now-lastTime)/1000,0.05);lastTime=now;
    if(!paused)elapsed+=delta;
    if(visible&&document.visibilityState!=="hidden"){
      yaw+=(targetYaw-yaw)*0.1;pitch+=(targetPitch-pitch)*0.1;zoom+=(targetZoom-zoom)*0.1;
      root.rotation.y=yaw+Math.sin(elapsed*0.22)*0.1;root.rotation.x=pitch;
      root.position.y=0.12+Math.sin(elapsed*0.7)*0.055;
      wingGroups.forEach(({group,side})=>{group.rotation.z=side*(-0.075+Math.sin(elapsed*0.9)*0.025);});
      particles.rotation.y=elapsed*0.018;
      camera.position.copy(baseCamera).multiplyScalar(zoom);camera.lookAt(0,0,0.35);
      renderer.render(scene,camera);frames++;
      if(now-lastLabelTime>150){coordinate.textContent="ROT. "+String(Math.round(yaw*180/Math.PI)).padStart(3,"0")+"° / "+(1/zoom).toFixed(2)+"×";lastLabelTime=now;}
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.addEventListener("pagehide",()=>{resizer.disconnect();observer.disconnect();scene.traverse(obj=>{obj.geometry?.dispose();if(obj.material){const mats=Array.isArray(obj.material)?obj.material:[obj.material];mats.forEach(m=>m.dispose());}});environment.dispose();renderer.dispose();},{once:true});
}catch(error){
  host.dataset.ready="false";
  fallback.querySelector("p").textContent="当前浏览器未能启用 WebGL，请尝试开启硬件加速。";
  fallback.querySelector(".loading-orbit").hidden=true;
  for(const button of [pauseButton,wireButton,document.getElementById("fly-reset")])button.disabled=true;
  console.error("Three.js specimen renderer failed",error);
}
