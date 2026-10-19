// The Worker receives read capabilities for two public accounts, never a key.
export function createFactoryWorkerPortV4(reader,index,{poolManifest=null}={}){
  const channel=new MessageChannel(),factory=reader.expected.factoryAddress,task=reader.a.task(factory,index),allowed=new Map([[factory.toBase58(),factory],[task.toBase58(),task]]);let closed=false,reads=0;
  const close=()=>{if(closed)return;closed=true;channel.port1.onmessage=null;channel.port1.close();channel.port2.close();};
  channel.port1.onmessage=async({data:m})=>{
    if(closed)return;
    try{
      if(!Number.isSafeInteger(m?.id)||m.id<1||++reads>8)throw new Error('RPC_REQUIRED');let value;
      if(m.method==='getGenesisHash')value=await reader.connection.getGenesisHash();
      else if(m.method==='getPoolManifest'&&poolManifest)value=poolManifest;
      else if(m.method==='getAccountInfo'&&allowed.has(m.address)){
        const account=await reader.connection.getAccountInfo(allowed.get(m.address),'finalized');value=account?{owner:account.owner.toBase58(),data:new Uint8Array(account.data)}:null;
      }else throw new Error('RPC_REQUIRED');
      if(!closed)channel.port1.postMessage({id:m.id,value});
    }catch{if(!closed)channel.port1.postMessage({id:m?.id,error:'Personal RPC could not verify the frozen task'});}
  };
  channel.port1.start();return {port:channel.port2,close};
}
