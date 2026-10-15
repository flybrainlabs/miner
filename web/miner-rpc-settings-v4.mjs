import {say} from './goal-status-text.mjs';
const text={
  required:['请先设置 Helius API Key，验证通过后才能准备和开始挖矿。','Set your Helius API key before preparing or starting mining.'],
  checking:['正在检查当前部署的网络与合约，请稍候…','Checking the deployed network and contract…'],
  'custom-session':['个人 RPC 已启用，仅在当前标签页保存。','Personal RPC enabled for this tab.'],
  'custom-remembered':['个人 RPC 已启用，并记在当前浏览器。','Personal RPC enabled and remembered in this browser.'],
  'memory-only':['个人 RPC 已启用；浏览器未允许保存，刷新后需重新填写。','Personal RPC enabled. Browser storage is unavailable; enter it again after reload.'],
  'restore-unavailable':['已保存的 Key 暂不可用。请检查 Key 和额度后重新验证，挖矿尚未开始。','Your saved key is unavailable. Check the key and quota, then verify again before mining.'],
  'reset-storage-unavailable':['已停止使用此 Key，但浏览器未允许清除保存项。请检查浏览器存储设置。','This key is no longer in use, but browser storage could not be cleared. Check browser storage settings.'],
  RPC_REQUIRED:['请先设置并验证 Helius API Key。','Set and verify your Helius API key first.'],
  RPC_INVALID_KEY:['请仅填写 Helius API Key，不要粘贴 RPC 地址。','Enter only your Helius API key, without the RPC URL.'],
  RPC_DEPLOYMENT_NETWORK:['当前部署网络配置不可用，请稍后重试。','The deployed network configuration is unavailable. Retry later.'],
  RPC_WRONG_NETWORK:['RPC 返回的网络与本站部署不符，已停止连接。无需手动选择网络。','The RPC returned a different network from this deployment. Connection stopped; network selection is automatic.'],
  RPC_FACTORY_MISMATCH:['该 RPC 的合约状态不匹配，已停止连接。','The RPC contract state does not match. Connection stopped.'],
  RPC_AUTH_FAILED:['API Key 不可用，请从 Helius 控制台重新复制 Key。','The API key is unavailable. Copy the key again from the Helius dashboard.'],
  RPC_RATE_LIMITED:['该 RPC 暂时限流，请检查 Helius 额度后重试。','This RPC is rate limited. Check your Helius quota and retry.'],
  RPC_UNAVAILABLE:['无法连接此 RPC。请检查 Key、网络及 Helius 的网站访问限制后重试。','Cannot connect. Check the key, connectivity and Helius website access restrictions, then retry.'],
  'sync-unavailable':['RPC 已保存，链上状态暂未刷新成功，正在重试。','RPC saved. Chain state could not refresh yet; retrying.'],
};
const node=(tag,className='')=>{const e=document.createElement(tag);if(className)e.className=className;return e;};
export class MinerRpcSettingsV4 {
  constructor({rpc,onChange=async()=>{},onStateChange=()=>{},parent}){
    this.rpc=rpc;this.onChange=onChange;
    this.root=node('details','miner-rpc-settings');this.root.id='miner-rpc-settings';this.root.dataset.noI18n='';
    const summary=node('summary');this.title=node('span');this.mode=node('span','rpc-mode');summary.append(this.title,this.mode);
    this.intro=node('p','field-note');const steps=node('ol','rpc-guide');
    const first=node('li');this.signup=node('a');Object.assign(this.signup,{href:'https://dashboard.helius.dev/signup?plan=free',target:'_blank',rel:'noopener noreferrer'});first.append(this.signup);
    this.step2=node('li');this.step3=node('li');steps.append(first,this.step2,this.step3);
    this.form=node('form');this.form.noValidate=true;this.form.setAttribute('aria-busy','false');
    const label=node('label');label.htmlFor='miner-rpc-key';this.label=node('span');
    this.input=node('input');Object.assign(this.input,{id:'miner-rpc-key',type:'password',autocomplete:'off',spellcheck:false,maxLength:256,placeholder:'Helius API Key'});this.input.setAttribute('autocapitalize','none');this.input.setAttribute('aria-describedby','miner-rpc-privacy miner-rpc-status');this.input.value=rpc.value;
    const row=node('div','rpc-address');this.show=node('button','button button-ghost');this.show.type='button';this.show.setAttribute('aria-controls',this.input.id);this.show.setAttribute('aria-pressed','false');row.append(this.input,this.show);label.append(this.label,row);
    const remember=node('label','rpc-remember');this.remember=node('input');this.remember.type='checkbox';this.remember.id='miner-rpc-remember';this.remember.checked=rpc.remember;this.rememberText=node('span');remember.append(this.remember,this.rememberText);
    this.privacy=node('p','field-note');this.privacy.id='miner-rpc-privacy';this.status=node('p','rpc-status');this.status.id='miner-rpc-status';this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');
    const actions=node('div','rpc-actions');this.apply=node('button','button button-ghost');this.apply.type='submit';this.apply.id='miner-rpc-apply';this.reset=node('button','button button-ghost');this.reset.type='button';this.reset.id='miner-rpc-reset';actions.append(this.apply,this.reset);
    this.form.append(label,remember,this.privacy,actions,this.status);this.root.append(summary,this.intro,steps,this.form);parent.before(this.root);
    const stylesheet=new URL('./miner-rpc-settings-v4.css',import.meta.url);stylesheet.search=new URL(import.meta.url).search;
    if(!document.getElementById('miner-rpc-style')){const link=node('link');link.id='miner-rpc-style';link.rel='stylesheet';link.href=stylesheet.href;document.head.append(link);}
    this.show.onclick=()=>{this.input.type=this.input.type==='password'?'text':'password';this.render();};
    this.form.onsubmit=async event=>{event.preventDefault();if(rpc.busy||this.changing)return;this.changing=true;this.render();try{await rpc.apply(this.input.value,{remember:this.remember.checked});await this.changed();}catch{}finally{this.changing=false;this.render();}};
    this.reset.onclick=async()=>{if(rpc.busy||this.changing)return;this.changing=true;this.render();try{rpc.reset();this.input.value='';this.input.type='password';this.remember.checked=false;await this.changed();}finally{this.changing=false;this.render();}};
    rpc.onChange=()=>{this.render();onStateChange();};this.render();
  }
  focus(){this.root.open=true;this.input.focus();this.root.scrollIntoView({block:'nearest',behavior:'smooth'});}
  async changed(){try{await this.onChange();}catch{this.rpc.status='sync-unavailable';}}
  render(){
    const rpc=this.rpc,busy=rpc.busy||this.changing;
    if(!rpc.ready)this.root.open=true;
    this.title.textContent=say('RPC 设置 · 必须完成','RPC settings · Required');this.mode.textContent=rpc.busy?say('检查中','Checking'):rpc.ready?say('已验证','Verified'):say('待设置','Setup needed');
    this.intro.textContent=say('挖矿需要使用自己的 Helius RPC。Helius 可以免费注册；免费方案有额度限制，以其控制台为准。','Mining requires your own Helius RPC. Helius offers free registration; free-plan quotas apply as shown in its dashboard.');
    const network=rpc.deployment.cluster==='devnet'?'Devnet':'Mainnet';
    this.signup.textContent=say('免费注册 Helius ↗','Register with Helius for free ↗');this.step2.textContent=say('在控制台创建并复制 API Key。','Create and copy an API key in the dashboard.');this.step3.textContent=say(`仅粘贴 Key，点击“验证并继续”。网络随本站部署自动选择，当前为 ${network}。`,`Paste only the key and choose “Verify and continue”. The network follows this deployment automatically: currently ${network}.`);
    this.label.textContent='Helius API Key';this.show.textContent=this.input.type==='password'?say('显示','Show'):say('隐藏','Hide');this.show.setAttribute('aria-pressed',String(this.input.type==='text'));
    this.rememberText.textContent=say('在此浏览器记住 Key','Remember the key in this browser');this.privacy.textContent=say('默认仅保存在当前标签页；勾选后保存在本机。Key 仅用于浏览器直接连接 Helius，不会发送给 flybrainwork 服务器。','Saved only in this tab by default; remembering stores it on this device. The key connects your browser directly to Helius and is not sent to flybrainwork servers.');
    this.apply.textContent=busy?say('正在验证…','Verifying…'):say('验证并继续','Verify and continue');this.reset.textContent=say('移除 Key','Remove key');this.form.setAttribute('aria-busy',String(!!busy));
    for(const control of [this.input,this.show,this.remember,this.apply,this.reset])control.disabled=!!busy;
    const message=text[rpc.status]||text.RPC_UNAVAILABLE;this.status.textContent=say(...message);this.status.dataset.error=String(rpc.status.startsWith('RPC_')||rpc.status.includes('unavailable'));
  }
  dispose(){this.rpc.onChange=()=>{};this.root.remove();}
}
