import { Writer,text,fromHex,pk } from '/assets/vendor/generated/solana-client.mjs';
export async function uploadArchive(client,connection,pending,bundle,progress=()=>{},signal) {
  const base=client.config.archives[0];if(!base)throw new Error('No explicitly configured result archive; export the response bundle');
  const signing=connection.wallet.features['solana:signMessage'];if(!signing)throw new Error('Wallet Standard message signing is required for archive authorization');
  const nonce=crypto.getRandomValues(new Uint8Array(32)),timestamp=Math.floor(Date.now()/1000),nonceHex=Array.from(nonce,b=>b.toString(16).padStart(2,'0')).join('');
  const message=new Writer().bytes(text('FlyPoW/archive-authorize/v1\0')).key(client.program).key(client.campaign).key(pk(pending.submission)).key(fromHex(bundle.archiveRoot)).key(nonce).i64(timestamp).result();
  const [signed]=await signing.signMessage({account:connection.account,message});
  const signature=btoa(String.fromCharCode(...signed.signature));
  const start=await fetch(base.replace(/\/$/,'')+'/v1/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({submission:pending.submission,miner:connection.account.address,timestamp,nonce:nonceHex,signature,manifest_json:new TextDecoder().decode(bundle.manifestBytes)}),signal});
  if(!start.ok)throw new Error('Archive authorization failed: '+await start.text());
  const ticket=await start.json();if(ticket.archive_root!==bundle.archiveRoot||ticket.chunk_bytes!==4*1024*1024||(!ticket.sealed&&!/^[a-f0-9]{64}$/.test(ticket.token)))throw new Error('Archive service protocol mismatch');
  if(ticket.sealed)return base.replace(/\/$/,'')+`/v1/archive/${bundle.archiveRoot}/manifest.json`;
  for(const [name,buffer]of [['response.bin',bundle.archive],['preview.json',bundle.previewBytes]]){
    const file=new Blob([buffer]);for(let offset=0;offset<file.size;offset+=ticket.chunk_bytes){const response=await fetch(base.replace(/\/$/,'')+`/v1/uploads/${ticket.token}/${name}?offset=${offset}`,{method:'PUT',headers:{Authorization:'Bearer '+ticket.token,'Content-Type':'application/octet-stream'},body:file.slice(offset,offset+ticket.chunk_bytes),signal});if(!response.ok)throw new Error('Archive chunk failed: '+await response.text());progress(name,Math.min(file.size,offset+ticket.chunk_bytes),file.size);}
  }
  const sealed=await fetch(base.replace(/\/$/,'')+`/v1/uploads/${ticket.token}/seal`,{method:'POST',headers:{Authorization:'Bearer '+ticket.token},signal});if(!sealed.ok)throw new Error('Archive integrity check failed: '+await sealed.text());
  return base.replace(/\/$/,'')+`/v1/archive/${bundle.archiveRoot}/manifest.json`;
}
