// Sole source of network selection. URL, old local preferences and the legacy
// Solana config cannot select a different authority or offline execution.
export function validateDeployment(d,model){
  if(d?.schema!=='flybrain-mining-deployment-v1'||d.version!==1||!['development','production'].includes(d.environment)||d.execution!=='target-v2'||!d.enabled||!d.networkId||!d.campaignId||!/^[0-9a-f]{64}$/.test(d.authorityId)||!(/^https:\/\//.test(d.apiBase)||d.environment==='development'&&d.apiBase===''))throw new Error('Deployment configuration is incomplete; reconnect after updating the site.');
  if(!d.capabilities?.completeReplay||!d.capabilities?.signedTelemetry||!d.capabilities?.roundHistory||d.capabilities.payment!==false||d.capabilities.rewards!==false||d.capabilities.requiredWallet!==false||d.capabilities.solana!==false)throw new Error('Deployment requests unsupported service capabilities.');
  for(const [a,b]of [['graphRoot','graph_sha256'],['modelDataRoot','model_sha256'],['modelRoot','model_root_sha256'],['registryRoot','registry_sha256']])if(d.model?.[a]!==model[b])throw new Error('Deployment and cached model versions disagree.');
  if(d.model.parameterVersion!==(model.parameter_version||'lif-point-v0-dev'))throw new Error('Deployment and cached model parameters disagree.');
  return Object.freeze({...d,developmentOnly:d.environment==='development',payment:d.capabilities.payment,rewards:d.capabilities.rewards,requiredWallet:d.capabilities.requiredWallet});
}
export function assertServiceIdentity(d,s){
  if(s.networkId!==d.networkId||s.authorityId!==d.authorityId||s.campaignId!==d.campaignId||s.environment!==d.environment)throw new Error('Node identity differs from this deployment. Reconnect after checking the deployment.');
  for(const key of ['completeReplay','signedTelemetry','roundHistory'])if(s.serviceCapabilities?.[key]!==d.capabilities[key])throw new Error('Node capabilities differ from this deployment.');
  for(const key of ['graphRoot','modelRoot','modelDataRoot','registryRoot','parameterProfileHash'])if(s.modelIdentity?.[key]!==d.model[key])throw new Error('Node model version differs from this deployment.');
  if(s.payment!==d.payment||s.rewards!==d.rewards)throw new Error('Node funding capabilities differ from this deployment.');return s;
}
