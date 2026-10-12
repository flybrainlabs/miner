import { THREE } from './anatomy-renderer.mjs';
import { clippedPath } from './ribbon-path.mjs';
// Nonindexed, bounded triangles. Every disconnected morphology part has its
// own strip. No tubes/materials/meshes are allocated per event or frame.
export class NeuralRibbon {
  constructor(group,{maxRoutes=96,segments=64}={}){
    Object.assign(this,{group,maxRoutes,segments});const vertices=maxRoutes*segments*6;this.geometry=new THREE.BufferGeometry();
    for(const [name,size]of [['position',3],['other',3],['side',1],['edgeSide',1],['strength',1]])this.geometry.setAttribute(name,new THREE.BufferAttribute(new Float32Array(vertices*size),size).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0,0);this.uniforms={resolution:{value:new THREE.Vector2(1,1)},width:{value:2},nearPlane:{value:.01}};
    const vertex='uniform vec2 resolution; uniform float width; uniform float nearPlane; attribute vec3 other; attribute float side; attribute float edgeSide; attribute float strength; varying float edge; varying float alpha; varying float visible; void main(){vec4 v=modelViewMatrix*vec4(position,1.0);vec4 o=modelViewMatrix*vec4(other,1.0);visible=step(nearPlane,-v.z)*step(nearPlane,-o.z);v.z=min(v.z,-nearPlane);o.z=min(o.z,-nearPlane);vec4 p=projectionMatrix*v;vec4 q=projectionMatrix*o;vec2 d=(q.xy/q.w-p.xy/p.w)*resolution;float n=length(d);vec2 normal=n>.00001?vec2(-d.y,d.x)/n:vec2(0.0,1.0);p.xy+=normal*side*width/resolution*p.w;gl_Position=p;edge=edgeSide;alpha=strength;}';
    const fragment='varying float edge; varying float alpha; varying float visible; void main(){if(visible<.5||alpha<=0.0)discard;float soft=pow(max(0.0,1.0-abs(edge)),.7);gl_FragColor=vec4(vec3(1.0,.98,.96),alpha*soft);}';
    this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,uniforms:this.uniforms,vertexShader:vertex,fragmentShader:fragment});
    this.mesh=new THREE.Mesh(this.geometry,this.material);this.mesh.frustumCulled=false;this.mesh.renderOrder=4;group.add(this.mesh);
    this.haloUniforms={...this.uniforms,width:{value:5}};this.haloMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,uniforms:this.haloUniforms,vertexShader:vertex,fragmentShader:fragment.replace('alpha*soft','alpha*soft*.18')});
    this.halo=new THREE.Mesh(this.geometry,this.haloMaterial);this.halo.frustumCulled=false;this.halo.renderOrder=3;group.add(this.halo);this.a={x:0,y:0,z:0};this.b={x:0,y:0,z:0};
  }
  viewport(renderer){renderer.getDrawingBufferSize(this.uniforms.resolution.value);const dpr=renderer.getPixelRatio();this.uniforms.width.value=2*dpr;this.haloUniforms.width.value=6*dpr;}
  update(activities,routes,reduced=false){
    const attributes=this.geometry.attributes;let vertex=0,count=0,clipped=0;
    for(const item of activities){if(count>=this.maxRoutes)break;const route=routes.get(item.event[1]),part=route?.parts[item.phase==='arrival'?1:0];if(!part||part.points.length<6||part.arcLengths.at(-1)<=0)continue;
      const head=reduced?.62:Math.min(.98,Math.max(.01,item.progress)),tail=Math.max(0,head-.22);if(head-tail<.002)continue;count++;
      clipped+=clippedPath(part,tail,head,item.phase==='arrival',this.segments,(a,b,fa,fb)=>{
        if(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<1e-8)return;
        const start=item.strength*(.15+.85*fa),end=item.strength*(.15+.85*fb);
        // End vertices use the reversed tangent and reversed side. Segment
        // quads cap corners, so joins cannot form unbounded miter spikes.
        // Projected triangles are counterclockwise for FrontSide materials.
        for(const [p,q,side,edgeSide,strength]of [[a,b,-1,-1,start],[b,a,1,-1,end],[a,b,1,1,start],[b,a,1,-1,end],[b,a,-1,1,end],[a,b,1,1,start]]){
          attributes.position.setXYZ(vertex,p.x,p.y,p.z);attributes.other.setXYZ(vertex,q.x,q.y,q.z);attributes.side.setX(vertex,side);attributes.edgeSide.setX(vertex,edgeSide);attributes.strength.setX(vertex,strength);vertex++;
        }
      },this.a,this.b);
    }
    this.geometry.setDrawRange(0,vertex);for(const a of Object.values(attributes))a.needsUpdate=true;this.routeCount=count;this.vertices=vertex;this.clippedSegments=clipped;
  }
  clear(){this.geometry.setDrawRange(0,0);this.routeCount=0;this.vertices=0;}
  snapshot(){return {routeCount:this.routeCount||0,vertices:this.vertices||0,maxRoutes:this.maxRoutes,clippedSegments:this.clippedSegments||0,maxSegmentsPerRoute:this.segments,bufferBytes:Object.values(this.geometry.attributes).reduce((s,a)=>s+a.array.byteLength,0),indexed:false,style:'white-core-soft-ribbon',newMeshPerFrame:false};}
  dispose(){this.group.remove(this.mesh,this.halo);this.geometry.dispose();this.material.dispose();this.haloMaterial.dispose();}
}
