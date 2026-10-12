export async function exportFiles(files,name){
  const size=files.reduce((n,f)=>n+(f.data.size??f.data.byteLength),0);if(size>384*1024*1024||files.length>128)throw new Error('Export exceeds the bounded 384 MiB background ZIP budget; download individual backgrounds.');
  const worker=new Worker('/assets/artifact-export-worker.mjs',{type:'module'});
  try{const bytes=await new Promise((resolve,reject)=>{worker.onmessage=({data:m})=>m.error?reject(new Error(m.error)):resolve(m.bytes);worker.onerror=e=>reject(new Error(e.message));worker.postMessage({files});});const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}finally{worker.terminate();}
}
