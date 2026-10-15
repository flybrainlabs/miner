// Sole source of network selection. URL, old local preferences and the legacy
// Solana config cannot select a different authority or offline execution.
export function validateDeployment(d,model){
  const v3=d?.schema==='flybrainlabs-mining-deployment-v3'&&d.version===3;
  const v4=d?.schema==='flybrainlabs-mining-deployment-v4'&&d.version===4;
  if(v4){
    if(d.environment!=='development'||d.execution!=='contract-v4'||d.enabled!==true||d.capabilities?.completeReplay!==true||d.capabilities?.roundHistory!==true||d.capabilities?.signedTelemetry!==false||['payment','rewards','requiredWallet','solana'].some(k=>d.capabilities?.[k]!==true)||d.taskFactoryV4?.configuration!=='/assets/data/task-factory-deployment-v4.json'||d.taskFactoryV4?.schema!=='flybrainlabs-task-factory-deployment-v4'||!/^https:\/\//.test(d.apiBase)||!/^[a-f0-9]{64}$/.test(d.authorityId)||!d.networkId||!d.campaignId)throw new Error('Unsupported contract task deployment');
    if(d.walletMining?.schema!=='flybrainlabs-wallet-mining-config-v3'||d.walletMining.cluster!=='devnet'||d.walletMining.genesisHash!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'||d.walletMining.configuration!=='/assets/data/wallet-mining-v3.json'||d.networkId!==d.walletMining.genesisHash||d.authorityId!==d.walletMining.policyHash||!d.walletMining.programId||!d.walletMining.mint||!/^[a-f0-9]{64}$/.test(d.walletMining.policyHash)||d.taskFactoryV4.factory!==d.campaignId||d.taskFactoryV4.programId!==d.walletMining.programId||!/^[a-f0-9]{64}$/.test(d.taskFactoryV4.catalogRoot))throw new Error('Unsupported shared wallet or factory identity');
    for(const [a,b]of [['graphRoot','graph_sha256'],['modelDataRoot','model_sha256'],['modelRoot','model_root_sha256'],['registryRoot','registry_sha256']])if(d.model?.[a]!==model[b])throw new Error('Deployment and cached model versions disagree.');
    if(d.model.parameterVersion!==(model.parameter_version||'lif-point-v0-dev'))throw new Error('Deployment and cached model parameters disagree.');
    return Object.freeze({...d,developmentOnly:true,payment:true,rewards:true,requiredWallet:true});
  }
  if(!(v3||d?.schema==='flybrain-mining-deployment-v1'&&d.version===1)||!['development','production'].includes(d.environment)||d.execution!=='target-v2'||!d.enabled||!d.networkId||!d.campaignId||!/^[0-9a-f]{64}$/.test(d.authorityId)||!(/^https:\/\//.test(d.apiBase)||d.environment==='development'&&d.apiBase===''))throw new Error('Deployment configuration is incomplete; reconnect after updating the site.');
  if(!d.capabilities?.completeReplay||!d.capabilities?.signedTelemetry||!d.capabilities?.roundHistory||['payment','rewards','requiredWallet','solana'].some(k=>d.capabilities[k]!==v3))throw new Error('Deployment requests unsupported service capabilities.');
  if(v3&&(d.environment!=='development'||d.walletMining?.schema!=='flybrainlabs-wallet-mining-config-v3'||d.walletMining.cluster!=='devnet'||d.walletMining.genesisHash!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'||d.walletMining.configuration!=='/assets/data/wallet-mining-v3.json'||!d.walletMining.programId||!d.walletMining.mint||!/^[a-f0-9]{64}$/.test(d.walletMining.policyHash)))throw new Error('Unsupported wallet mining deployment');
  for(const [a,b]of [['graphRoot','graph_sha256'],['modelDataRoot','model_sha256'],['modelRoot','model_root_sha256'],['registryRoot','registry_sha256']])if(d.model?.[a]!==model[b])throw new Error('Deployment and cached model versions disagree.');
  if(d.model.parameterVersion!==(model.parameter_version||'lif-point-v0-dev'))throw new Error('Deployment and cached model parameters disagree.');
  return Object.freeze({...d,developmentOnly:d.environment==='development',payment:d.capabilities.payment,rewards:d.capabilities.rewards,requiredWallet:d.capabilities.requiredWallet});
}
export function assertServiceIdentity(d,s){
  if(s.networkId!==d.networkId||s.authorityId!==d.authorityId||s.campaignId!==d.campaignId||s.environment!==d.environment)throw new Error('Node identity differs from this deployment. Reconnect after checking the deployment.');
  for(const key of ['completeReplay','signedTelemetry','roundHistory'])if(s.serviceCapabilities?.[key]!==d.capabilities[key])throw new Error('Node capabilities differ from this deployment.');
  for(const key of ['graphRoot','modelRoot','modelDataRoot','registryRoot','parameterProfileHash'])if(s.modelIdentity?.[key]!==d.model[key])throw new Error('Node model version differs from this deployment.');
  // Scientific signatures keep the historical no-payment domain. The separate
  // V3 gateway and chain plan authenticate financial capability at admission.
  if(s.payment!==false||s.rewards!==false)throw new Error('Scientific funding domain differs from this deployment.');return s;
}
