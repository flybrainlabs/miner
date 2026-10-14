import { THREE } from './anatomy-renderer.mjs';

// Reuse the displayed anatomy surfaces. No readback, new geometry or model work.
export function installMiningLogOcclusion(anatomy){
  const material=new THREE.MeshBasicMaterial({color:'#111111',side:THREE.DoubleSide,depthTest:false,depthWrite:false,toneMapped:false});
  const surfaces=[];
  for(const outline of anatomy.outlines.children){
    if(!outline.isMesh)continue;
    const surface=new THREE.Mesh(outline.geometry,material);
    surface.name='mining-log-occlusion';surface.renderOrder=-100;
    // The parent's visibility, transforms and camera framing remain authoritative.
    outline.add(surface);surfaces.push(surface);
  }
  anatomy.draw();
  return {ready:surfaces.length>0,surfaces,dispose(){
    for(const surface of surfaces)surface.removeFromParent();
    material.dispose();if(anatomy.alive)anatomy.draw();
  }};
}
