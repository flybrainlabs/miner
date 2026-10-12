// Visit clipped original polyline edges; never join samples across SWC bends.
// If the span exceeds the display budget, keep the portion nearest its head.
export function clippedPath(part,tail,head,reverse,maxSegments,visit,a={x:0,y:0,z:0},b={x:0,y:0,z:0}){
  const arc=part?.arcLengths,p=part?.points,total=arc?.at(-1);if(!total||!p||arc.length<2||head<=tail)return 0;
  const low=(reverse?1-head:tail)*total,high=(reverse?1-tail:head)*total;
  const segmentAt=d=>{let lo=0,hi=arc.length-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(arc[mid]<=d)lo=mid;else hi=mid;}return lo;};
  let first=segmentAt(low),last=segmentAt(high);const available=last-first+1;
  if(reverse)last=Math.min(last,first+maxSegments-1);else first=Math.max(first,last-maxSegments+1);
  const point=(i,d,out)=>{const span=arc[i+1]-arc[i],u=span?Math.max(0,Math.min(1,(d-arc[i])/span)):0;out.x=p[i*3]+(p[i*3+3]-p[i*3])*u;out.y=p[i*3+1]+(p[i*3+4]-p[i*3+1])*u;out.z=p[i*3+2]+(p[i*3+5]-p[i*3+2])*u;};
  const fade=d=>Math.max(0,Math.min(1,((reverse?1-d/total:d/total)-tail)/(head-tail)));
  for(let i=first;i<=last;i++){const lo=Math.max(low,arc[i]),hi=Math.min(high,arc[i+1]);if(hi-lo<1e-9)continue;point(i,reverse?hi:lo,a);point(i,reverse?lo:hi,b);visit(a,b,fade(reverse?hi:lo),fade(reverse?lo:hi));}
  return Math.max(0,available-maxSegments);
}
