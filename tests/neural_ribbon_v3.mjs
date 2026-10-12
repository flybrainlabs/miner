import assert from 'node:assert/strict';
import {THREE} from '../web/anatomy-renderer.mjs';
import {NeuralRibbon} from '../web/neural-ribbon.mjs';
const group=new THREE.Group(),ribbon=new NeuralRibbon(group,{maxRoutes:2,segments:4});
for(const [x,y]of [[10,0],[0,10],[-10,4]]){
 const part={points:new Float32Array([0,0,0,x,y,0]),arcLengths:new Float32Array([0,Math.hypot(x,y)])};ribbon.update([{event:[0,1,0,1,1],phase:'emission',progress:.5,strength:1}],new Map([[1,{parts:[part]}]]));assert.equal(ribbon.vertices,6);
 const a=ribbon.geometry.attributes,projected=Array.from({length:6},(_,i)=>{const dx=a.other.getX(i)-a.position.getX(i),dy=a.other.getY(i)-a.position.getY(i),n=Math.hypot(dx,dy);return [a.position.getX(i)-dy/n*a.side.getX(i),a.position.getY(i)+dx/n*a.side.getX(i)];});
 for(let i=0;i<6;i+=3){const [p,q,r]=projected.slice(i,i+3);assert((q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])>0,'Projected ribbon must face the camera instead of being culled');}
 assert.equal(ribbon.material.side,THREE.FrontSide);assert.equal(ribbon.snapshot().bufferBytes,2*4*6*9*4);
}
ribbon.clear();assert.equal(ribbon.geometry.drawRange.count,0);ribbon.dispose();assert.equal(group.children.length,0);
console.log(JSON.stringify({passed:3,scope:'Projected strip winding in three directions; fixed buffer and explicit clear/dispose, not a physical GPU measurement'}));
