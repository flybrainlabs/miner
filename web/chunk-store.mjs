// Durable, bounded OPFS staging. Partial writes have no valid checkpoint and are re-fetched.
import { hashBytes } from '/assets/vendor/generated/official-builder.mjs?v=single-check-v1';
import { inputDirectoryName } from './model-storage.mjs';
import { officialReadURL } from './official-source.mjs';
export { inputDirectoryName } from './model-storage.mjs';
const CHUNK=4*1024*1024;
async function boundedBody(response, length, onRead=()=>{}) {
  if(!response.body)throw new Error('Official response is not a readable stream');
  const reader=response.body.getReader(),out=new Uint8Array(length);let n=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;if(n+value.length>length)throw new Error('Official Range body exceeds requested block');out.set(value,n);n+=value.length;onRead(n);}if(n!==length)throw new Error('Official Range body ended early');return out;}
  finally{await reader.cancel().catch(()=>{});}
}
export async function stageSource(directory, source, localFile, progress, offline=false) {
  const url=officialReadURL(source);
  let retryCount=0;
  const report=(stage,loaded)=>progress(stage+' '+source.id,loaded,source.bytes,{sourceId:source.id,sourceStage:stage.toLowerCase(),unit:'bytes',retryCount});
  if(localFile && localFile.size!==source.bytes) throw new Error(source.id+' local file length mismatch');
  const metaName=source.id+'-chunks.json', dataName=source.id+'.feather';
  const handle=await directory.getFileHandle(dataName,{create:true});
  let meta={schema:1,sha256:source.sha256,bytes:source.bytes,chunk_bytes:CHUNK,chunks:[]};
  try { const old=JSON.parse(await (await directory.getFileHandle(metaName)).getFile().then(f=>f.text())); if(old.schema===1 && old.sha256===source.sha256 && old.bytes===source.bytes && old.chunk_bytes===CHUNK && Array.isArray(old.chunks)) meta=old; } catch {}
  const sync=await handle.createSyncAccessHandle();
  let fullReader=null, fullOffset=0, remainder=new Uint8Array();
  const checkpoint=async()=> { const m=await directory.getFileHandle(metaName,{create:true}); const w=await m.createWritable(); await w.write(JSON.stringify(meta)); await w.close(); };
  const wholeStream=async(offset,length)=>{
    if(!fullReader) { const res=await fetch(url,{mode:'cors',cache:'no-store',credentials:'omit'}); if(!res.ok || !res.body || res.type==='opaque') throw new Error('Official CORS/read failed; download from official source and import locally'); fullReader=res.body.getReader(); }
    const output=new Uint8Array(length); let copied=0;
    while(fullOffset<offset+length) {
      if(!remainder.length) { const next=await fullReader.read(); if(next.done) throw new Error('Official stream ended early'); remainder=next.value; }
      const skip=Math.min(remainder.length,Math.max(0,offset-fullOffset)); remainder=remainder.subarray(skip); fullOffset+=skip;
      const n=Math.min(remainder.length,length-copied); output.set(remainder.subarray(0,n),copied); copied+=n; fullOffset+=n; remainder=remainder.subarray(n);report('Downloading',offset+copied);
    }
    return output;
  };
  try {
    for(let at=0, index=0;at<source.bytes;at+=CHUNK,index++) {
      const length=Math.min(CHUNK,source.bytes-at); const saved=meta.chunks[index]; let bytes=new Uint8Array(length);
      const read=sync.read(bytes,{at});
      if(saved?.bytes===length && read===length && hashBytes(bytes)===saved.sha256) { report('Restoring',at+length); continue; }
      if(offline&&!localFile)throw new Error('Official file required: '+source.id);
      if(localFile) bytes=new Uint8Array(await localFile.slice(at,at+length).arrayBuffer());
      else if(fullReader) bytes=await wholeStream(at,length);
      else {
        let res;
        for(let attempt=0;attempt<3;attempt++){
          try { res=await fetch(url,{mode:'cors',cache:'no-store',credentials:'omit',headers:{Range:`bytes=${at}-${at+length-1}`}});if(![408,429,500,502,503,504].includes(res.status))break;await res.body?.cancel().catch(()=>{}); }
          catch {if(attempt===2)throw new Error('Official browser read failed (cross-origin policy or network); download the official file and import it');}
          retryCount++;report('Downloading',at);if(attempt===2)throw new Error('Official read retry limit reached');
        }
        if(res.status===206) {
          if(res.headers.get('Content-Range')!==`bytes ${at}-${at+length-1}/${source.bytes}`){await res.body?.cancel().catch(()=>{});throw new Error('Official Range response identity mismatch');}
          bytes=await boundedBody(res,length,n=>report('Downloading',at+n));
        } else if(res.status===200 && res.body) { fullReader=res.body.getReader(); bytes=await wholeStream(at,length); }
        else {await res.body?.cancel().catch(()=>{});throw new Error('Official response unavailable: '+res.status);}
      }
      if(bytes.length!==length || sync.write(bytes,{at})!==length) throw new Error('Incomplete data block');
      sync.flush(); meta.complete=false;meta.chunks[index]={bytes:length,sha256:hashBytes(bytes)}; await checkpoint(); report('Caching',at+length);
    }
    sync.truncate(source.bytes); sync.flush();
  } finally { sync.close(); await fullReader?.cancel().catch(()=>{}); }
  const file=await handle.getFile();
  // Staging only records recoverable blocks. All sources are checked together
  // exactly once by the builder, after the last download/import has finished.
  meta.complete=false;await checkpoint();
  report('Staged',source.bytes);
  return file;
}

// Called only after the builder has matched this staged File to the frozen SHA.
export async function markSourceChecked(directory,source) {
  const handle=await directory.getFileHandle(source.id+'-chunks.json');
  const meta=JSON.parse(await(await handle.getFile()).text());
  if(meta.schema!==1 || meta.sha256!==source.sha256 || meta.bytes!==source.bytes || meta.chunk_bytes!==CHUNK
    || !Array.isArray(meta.chunks) || meta.chunks.length!==Math.ceil(source.bytes/CHUNK)
    || meta.chunks.some((c,i)=>c?.bytes!==Math.min(CHUNK,source.bytes-i*CHUNK)))
    throw new Error('Staged input checkpoint differs from the verified source');
  meta.complete=true;
  const writer=await handle.createWritable();
  await writer.write(JSON.stringify(meta));await writer.close();
}

export async function saveArtifact(directory,name,bytes,progress=()=>{}) {
  const h=await directory.getFileHandle(name,{create:true}); const sync=await h.createSyncAccessHandle();
  try { for(let at=0;at<bytes.length;at+=CHUNK) { const b=bytes.subarray(at,at+CHUNK); if(sync.write(b,{at})!==b.length) throw new Error('OPFS artifact write interrupted'); progress('Saving '+name,at+b.length,bytes.length,{stageId:'construct',unit:'bytes',substage:'saving'}); } sync.truncate(bytes.length); sync.flush(); }
  finally { sync.close(); }
}
