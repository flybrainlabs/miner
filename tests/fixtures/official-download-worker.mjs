// Local acceptance fixture. Never included in a production export.
import {stageSource,markSourceChecked} from '/assets/chunk-store.mjs?v=single-check-v1';
import {verifyOfficialInputs} from '/assets/vendor/generated/official-builder.mjs?v=single-check-v1';
import {inputDirectoryName} from '/assets/model-storage.mjs';
self.onmessage=async({data:{source,manifest,mode}})=>{
 const stages=new Set();let fullScans=0;
 const progress=(label,n)=>{stages.add(label);if(label==='Checking '+source.id&&n===0)fullScans++;};
 try{
  const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle(inputDirectoryName(manifest),{create:true});
  if(mode==='damage'||mode==='wrong-range'){
   const h=await dir.getFileHandle(source.id+'.feather'),f=await h.getFile(),v=new Uint8Array(await f.slice(10,11).arrayBuffer())[0],w=await h.createWritable({keepExistingData:true});
   await w.write({type:'write',position:10,data:new Uint8Array([v^1])});await w.close();
  }
  if(mode==='wrong-range'){
   const realFetch=self.fetch.bind(self);self.fetch=async(url,opt)=>{const r=await realFetch(url,opt),h=new Headers(r.headers);h.set('Content-Range','bytes 0-1/2');return new Response(r.body,{status:r.status,headers:h})};
  }
  const file=await stageSource(dir,source,null,progress);
  const staged=JSON.parse(await(await(await dir.getFileHandle(source.id+'-chunks.json')).getFile()).text());
  if(staged.complete||fullScans!==0)throw new Error('Staging cannot claim a full content check');
  await verifyOfficialInputs({[source.id]:file},{...manifest,sources:[source]},progress,s=>markSourceChecked(dir,s));
  const meta=JSON.parse(await(await(await dir.getFileHandle(source.id+'-chunks.json')).getFile()).text());
  self.postMessage({ok:true,bytes:file.size,complete:meta.complete,fullScans,stages:[...stages]});
 }catch(e){self.postMessage({ok:false,detail:String(e.message),fullScans,stages:[...stages]});}
};
