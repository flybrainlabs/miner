// These names preserve existing browser caches; UI release versions must not erase data.
export const modelDirectoryName=c=>`flypow-research-${c.graph_sha256.slice(0,16)}-${c.model_sha256.slice(0,16)}`;
export const inputDirectoryName=m=>`flypow-inputs-${m.builder}-${m.registry_sha256.slice(0,16)}`;
const parse=async(d,n)=>JSON.parse(await(await d.getFileHandle(n)).getFile().then(f=>f.text()));
const size=async(d,n)=>{try{return(await(await d.getFileHandle(n)).getFile()).size;}catch{return 0;}};
export async function inspectStorage(config,manifest){
  const result={model:false,modelBytes:0,inputs:[],oldVersions:0,opfs:!!navigator.storage?.getDirectory,estimate:null};
  result.estimate=await navigator.storage?.estimate?.().catch(()=>null);
  if(!result.opfs)return result;
  try{
    const root=await navigator.storage.getDirectory();
    let d;try{d=await root.getDirectoryHandle(modelDirectoryName(config));}catch{}
    if(d){result.modelBytes=await size(d,'graph-v1.bin')+await size(d,'model-v0.bin');try{const id=await parse(d,'identity.json');result.model=id.graph_sha256===config.graph_sha256&&id.model_sha256===config.model_sha256&&id.graph_bytes===config.graph_bytes&&id.model_bytes===config.model_bytes&&await size(d,'graph-v1.bin')===config.graph_bytes&&await size(d,'model-v0.bin')===config.model_bytes;}catch{}}
    let inputs;try{inputs=await root.getDirectoryHandle(inputDirectoryName(manifest));}catch{}
    for(const s of manifest.sources){let meta=null;if(inputs)try{meta=await parse(inputs,s.id+'-chunks.json');}catch{}
      const valid=meta?.sha256===s.sha256&&meta?.bytes===s.bytes&&meta?.chunk_bytes===4*1024*1024&&Array.isArray(meta.chunks);
      const bytes=inputs?await size(inputs,s.id+'.feather'):0;
      result.inputs.push({id:s.id,bytes,checkedBytes:valid?meta.chunks.reduce((n,c)=>n+(c?.bytes||0),0):0,complete:valid&&meta.complete===true&&bytes===s.bytes});
    }
    for await(const [name]of root.entries())if((name.startsWith('flypow-research-')&&name!==modelDirectoryName(config))||(name.startsWith('flypow-inputs-')&&name!==inputDirectoryName(manifest)))result.oldVersions++;
  }catch{result.opfs=false;}
  return result;
}
export function storageBudget(config,manifest,inventory={}){
  const inputs=manifest.sources.reduce((n,s)=>n+s.bytes,0),model=config.graph_bytes+config.model_bytes,reserve=16*1024*1024;
  const present=manifest.sources.reduce((n,s)=>n+Math.min(s.bytes,inventory.inputs?.find(i=>i.id===s.id)?.bytes||0),0)+Math.min(model,inventory.modelBytes||0);
  const missing=manifest.sources.reduce((n,s)=>n+Math.max(0,s.bytes-Math.min(s.bytes,inventory.inputs?.find(i=>i.id===s.id)?.checkedBytes||0)),0);
  return {download:inputs,newDownload:inventory.model?0:missing,model,browserCache:inputs+model,extra:inventory.model?reserve:Math.max(0,inputs+model-present)+reserve,localDownload:inputs};
}
