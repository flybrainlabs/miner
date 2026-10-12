import * as ModernThree from './vendor/three/three.module.min.js';

function context(canvas,kind,attributes){
  try{return canvas.getContext(kind,attributes);}catch{return null;}
}
function supportsWebGL2(){
  if(!globalThis.document)return true;
  const canvas=document.createElement('canvas');
  const gl=context(canvas,'webgl2',{alpha:true,antialias:false,powerPreference:'default'});
  if(!gl)return false;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
}

// Keep every scene/geometry/material in the same Three.js version. r180 no
// longer accepts WebGL 1; load the pinned compatibility engine only if needed.
export const THREE=supportsWebGL2()?ModernThree:await import('./vendor/three-webgl1/three.module.min.js');

export function createAnatomyRenderer({antialias=true}={}){
  const compatible=THREE.REVISION==='162';
  const kinds=compatible?['webgl2','webgl','experimental-webgl']:['webgl2'];
  const attempts=[{antialias,powerPreference:'low-power'},{antialias:false,powerPreference:'default'}];
  for(const attributes of attempts){
    for(const kind of kinds){
      const canvas=document.createElement('canvas');
      const gl=context(canvas,kind,{alpha:true,depth:true,stencil:false,...attributes});
      if(!gl)continue;
      try{
        const renderer=new THREE.WebGLRenderer({canvas,context:gl,alpha:true,...attributes});
        const version=kind==='webgl2'?'webgl2':'webgl1';
        canvas.dataset.renderer=version;canvas.dataset.antialias=String(gl.getContextAttributes().antialias);
        return renderer;
      }catch{
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    }
  }
  const error=new Error('The browser could not create a WebGL 2 or WebGL 1 context.');
  error.code='webgl-unavailable';throw error;
}
