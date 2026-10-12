// Real connected SWC chains, sampled by display-polyline arc length.
// Cell-level events are morphology-guided; no synapse pair is invented.
export function validateTopology(g,bodyId,modelIndex){
  if(g.schema!=='flypow-morphology-topology-v2'||g.dataset!=='male-cns:v1.0'||g.bodyId!==String(bodyId)||g.modelIndex!==modelIndex||g.units!=='8 nm voxels')throw new Error('Exact-body SWC topology identity');
  const n=g.nodeIds?.length;if(!n||n>300000||g.parentIndices.length!==n||g.xyz.length!==n||g.nodeTypes.length!==n||g.radii.length!==n||g.componentIds.length!==n||new Set(g.nodeIds).size!==n||g.nodeIds.some(x=>!Number.isSafeInteger(x)||x<1)||g.nodeTypes.some(x=>!Number.isSafeInteger(x)||x<0)||!Number.isInteger(g.displayOrigin)||g.displayOrigin<0||g.displayOrigin>=n)throw new Error('Topology dimensions/identities');
  const children=Array.from({length:n},()=>[]),roots=[];
  for(let i=0;i<n;i++){const p=g.parentIndices[i];if(!Number.isInteger(p)||p< -1||p>=n||p===i||g.xyz[i].length!==3||!g.xyz[i].every(Number.isFinite)||!Number.isFinite(g.radii[i])||g.radii[i]<0)throw new Error('SWC parent/coordinates');if(p===-1)roots.push(i);else children[p].push(i);}
  if(JSON.stringify(roots)!==JSON.stringify(g.roots))throw new Error('SWC roots');const seen=new Set();for(let c=0;c<roots.length;c++){const todo=[roots[c]];while(todo.length){const i=todo.pop();if(seen.has(i)||g.componentIds[i]!==c)throw new Error('SWC cycle/component');seen.add(i);todo.push(...children[i]);}}if(seen.size!==n)throw new Error('Disconnected cycle');
  for(const lod of g.lods){const covered=new Set();for(const chain of lod.chains){const original=chain.originalNodeIndices,display=chain.displayNodeIndices;if(original.length<2||display.length<2||original.some(i=>!Number.isInteger(i)||i<0||i>=n)||display[0]!==original[0]||display.at(-1)!==original.at(-1)||chain.componentId!==g.componentIds[original[0]]||chain.arcLengths.length!==display.length||chain.arcLengths[0]!==0||chain.arcLengths.some(x=>!Number.isFinite(x)||x<0)||original.slice(1,-1).some(i=>children[i].length!==1))throw new Error('Connected chain bounds');let previous=-1;for(let j=0;j<display.length;j++){const at=original.indexOf(display[j],previous+1);if(at<0||j&&chain.arcLengths[j]<chain.arcLengths[j-1])throw new Error('Display chain mapping');previous=at;}
      for(let j=1;j<original.length;j++){const a=original[j-1],b=original[j];if(g.parentIndices[b]!==a||g.componentIds[b]!==chain.componentId||covered.has(b))throw new Error('Route is not an original parent chain');covered.add(b);}}
    if(covered.size!==n-roots.length)throw new Error('LOD dropped topology edges');}
  return g;
}
function arc(points){const out=new Float32Array(points.length/3);for(let i=1;i<out.length;i++)out[i]=out[i-1]+Math.hypot(points[i*3]-points[i*3-3],points[i*3+1]-points[i*3-2],points[i*3+2]-points[i*3-1]);return out;}
export function compileMorphology(g,context,lod=1){
  validateTopology(g,g.bodyId,g.modelIndex);if(!g.lods[lod])throw new Error('LOD unavailable');const scale=2/context.extent,center=context.center;
  const position=i=>[(g.xyz[i][0]-center[0])*scale,-(g.xyz[i][2]-center[2])*scale,(g.xyz[i][1]-center[1])*scale];
  const chains=g.lods[lod].chains.map(c=>({...c,points:Float32Array.from(c.displayNodeIndices.flatMap(position))}));const background=[];
  const incoming=new Map(),outgoing=new Map();for(const c of chains){const start=c.originalNodeIndices[0],end=c.originalNodeIndices.at(-1);incoming.set(end,c);if(!outgoing.has(start))outgoing.set(start,[]);outgoing.get(start).push(c);for(let j=3;j<c.points.length;j+=3)background.push(...c.points.subarray(j-3,j),...c.points.subarray(j,j+3));}
  // Longest connected root-to-tip path per component, ties by original node id.
  const distances=new Map(),candidates=[];const visit=[...g.roots];for(const r of g.roots)distances.set(r,0);
  while(visit.length){const start=visit.pop(),next=outgoing.get(start)||[];if(!next.length)candidates.push(start);for(const c of next){const end=c.originalNodeIndices.at(-1);const len=arc(c.points).at(-1);distances.set(end,distances.get(start)+len);visit.push(end);}}
  candidates.sort((a,b)=>distances.get(b)-distances.get(a)||g.nodeIds[a]-g.nodeIds[b]);const terminals=candidates.filter(i=>incoming.has(i));
  const paths=terminals.slice(0,8).map(end=>{const sequence=[];for(let at=end;incoming.has(at);){const c=incoming.get(at);sequence.push(c);at=c.originalNodeIndices[0];}sequence.reverse();const nodes=[],points=[];for(const c of sequence){nodes.push(...c.originalNodeIndices.slice(nodes.length?1:0));points.push(...c.points.subarray(points.length?3:0));}const typed=Float32Array.from(points);return {kind:'skeleton-chain',bodyId:g.bodyId,componentId:g.componentIds[end],originalNodeIndices:nodes,points:typed,arcLengths:arc(typed),topologyHash:g.topologyHash};});
  return {bodyId:g.bodyId,modelIndex:g.modelIndex,topologyHash:g.topologyHash,sourceSha256:g.sourceSha256,lod,background:Float32Array.from(background),paths,displayOrigin:position(g.displayOrigin),roots:g.roots.length};
}
export function buildMorphologyRoute(edge,source,target,graphRoot){
  const pick=(g,j)=>g?.paths?.length?g.paths[(edge.edgeId+j)%g.paths.length]:null;
  const a=pick(source,0),b=pick(target,1);return {edgeId:edge.edgeId,sourceBodyId:source?.bodyId||null,targetBodyId:target?.bodyId||null,graphRoot,mode:a&&b?'morphology-guided':'unavailable',parts:[a,b],provenance:{sourceHash:source?.sourceSha256,targetHash:target?.sourceSha256,sourceTopology:source?.topologyHash,targetTopology:target?.topologyHash,officialSynapsePairs:0,spatialTransition:'none; fade at source and respond on target at recorded arrival',biologicalVoltageOrVelocity:false}};
}
export function samplePart(part,u,out={x:0,y:0,z:0,alpha:0}){
  if(!part||part.points.length<6)return null;u=Math.max(0,Math.min(1,u));const lengths=part.arcLengths,total=lengths.at(-1),distance=u*total;let lo=0,hi=lengths.length-1;
  while(lo+1<hi){const mid=(lo+hi)>>1;if(lengths[mid]<=distance)lo=mid;else hi=mid;}
  const span=lengths[hi]-lengths[lo],f=span?Math.max(0,Math.min(1,(distance-lengths[lo])/span)):0,p=part.points;out.x=p[lo*3]+(p[hi*3]-p[lo*3])*f;out.y=p[lo*3+1]+(p[hi*3+1]-p[lo*3+1])*f;out.z=p[lo*3+2]+(p[hi*3+2]-p[lo*3+2])*f;out.alpha=1;return out;
}
export function sampleRoute(route,u,phase='emit',out){if(route?.mode!=='morphology-guided')return null;const part=phase==='arrival'?route.parts[1]:route.parts[0],p=samplePart(part,phase==='arrival'?1-u:u,out);if(p)p.alpha=phase==='arrival'?Math.max(0,1-u):Math.min(1,(1-u)*5);return p;}
