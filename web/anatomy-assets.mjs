import { digest } from './response-record.mjs';
import { validateGeometry } from './atlas-core.js';
import { validateTopology } from './propagation-routes.mjs';
import { throwIfAborted } from './browser-abort.mjs';
// Shared bounded JSON asset cache; consumers retain independent cancellation.
export class AnatomyAssetStore {
  constructor(maxBytes=32*1024*1024){this.maxBytes=maxBytes;this.bytes=0;this.cache=new Map();this.pending=new Map();}
  async get(path,hash,signal){
    const key=path+'#'+(hash||'');throwIfAborted(signal);if(this.cache.has(key)){const value=this.cache.get(key);this.cache.delete(key);this.cache.set(key,value);return value.data;}
    let job=this.pending.get(key);
    // A deployment can change a hash-pinned JSON while the old URL remains
    // fresh in the phone's HTTP cache. Version the display URL, never clear OPFS.
    const requestPath=hash?path+(path.includes('?')?'&':'?')+'sha256='+encodeURIComponent(hash):path;
    if(!job){const controller=new AbortController();job={controller,users:0};job.promise=(async()=>{const r=await fetch(requestPath,{signal:controller.signal});if(!r.ok)throw new Error('Anatomy asset unavailable');const raw=await r.arrayBuffer();if(raw.byteLength>16*1024*1024||hash&&await digest(raw)!==hash)throw new Error('Anatomy asset hash mismatch');const data=JSON.parse(new TextDecoder().decode(raw));if(raw.byteLength<=this.maxBytes){while(this.bytes+raw.byteLength>this.maxBytes&&this.cache.size){const oldest=this.cache.keys().next().value;this.bytes-=this.cache.get(oldest).bytes;this.cache.delete(oldest);}this.cache.set(key,{data,bytes:raw.byteLength});this.bytes+=raw.byteLength;}return data;})().finally(()=>this.pending.delete(key));this.pending.set(key,job);}
    job.users++;let abort;
    try{return await Promise.race([job.promise,new Promise((_,reject)=>{abort=()=>reject(new DOMException('Anatomy selection changed','AbortError'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();})]);}
    finally{signal?.removeEventListener('abort',abort);if(--job.users===0&&this.pending.has(key))job.controller.abort();}
  }
  async geometry(cell,config,signal){if(cell.status!=='exact-skeleton')return null;const g=validateGeometry(await this.get(cell.geometry,cell.geometry_sha256,signal));if(String(g.body_id)!==cell.body_id||g.source_sha256!==cell.source_sha256||g.source!==cell.source||!Number.isSafeInteger(cell.model_index)||cell.model_index<0||cell.model_index>=config.neuron_count)throw new Error('Exact-body geometry identity rejected');return g;}
  async topology(cell,config,signal){if(!cell.topology)throw new Error('Original SWC topology unavailable');const g=validateTopology(await this.get(cell.topology,cell.topology_sha256,signal),cell.body_id,cell.model_index);if(g.sourceSha256!==cell.source_sha256||g.source!==cell.source||g.topologyHash!==cell.topology_hash||cell.model_index>=config.neuron_count)throw new Error('Original SWC source identity');return g;}
  clear(){for(const job of this.pending.values())job.controller.abort();this.pending.clear();this.cache.clear();this.bytes=0;}
}
export const anatomyAssets=new AnatomyAssetStore();
export function validateAnatomyIndex(index,config){
  if(!['flypow-mining-anatomy-v1','flypow-mining-anatomy-v2'].includes(index.schema)||index.dataset!=='male-cns:v1.0'||index.units!=='8 nm voxels'||index.registryRoot!==config.registry_sha256||index.graphRoot!==config.graph_sha256)throw new Error('Anatomy registry identity mismatch');
  const bodies=new Set(),indices=new Set();for(const c of index.cells){if(!/^\d+$/.test(c.body_id)||bodies.has(c.body_id)||indices.has(c.model_index)||!Number.isSafeInteger(c.model_index)||c.model_index<0||c.model_index>=config.neuron_count)throw new Error('Anatomy mapping rejected');bodies.add(c.body_id);indices.add(c.model_index);if(c.geometry&&!/^\/assets\/data\/mining-anatomy\/\d+\.json$/.test(c.geometry))throw new Error('Anatomy asset path rejected');}return index;
}
