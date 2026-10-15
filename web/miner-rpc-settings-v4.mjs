import {say} from './goal-status-text.mjs';
const text={
  default:['当前使用默认共享 RPC。','Using the default shared RPC.'],
  checking:['正在检查 Devnet 网络与合约，请稍候…','Checking the Devnet network and contract…'],
  'custom-session':['个人 RPC 已启用，仅在当前标签页保存。','Personal RPC enabled for this tab.'],
  'custom-remembered':['个人 RPC 已启用，并记在当前浏览器。','Personal RPC enabled and remembered in this browser.'],
  'memory-only':['个人 RPC 已启用；浏览器未允许保存，刷新后需重新填写。','Personal RPC enabled. Browser storage is unavailable; enter it again after reload.'],
  'restore-unavailable':['已保存的个人 RPC 暂不可用，当前使用默认 RPC。请检查地址和额度。','Your saved personal RPC is unavailable. Using the default RPC; check the address and quota.'],
  'reset-storage-unavailable':['已恢复默认 RPC，但浏览器未允许清除保存项。','Default RPC restored, but browser storage could not be cleared.'],
  RPC_INVALID_URL:['请填写完整的 Helius HTTPS RPC 地址，包括 api-key。','Enter the full Helius HTTPS RPC URL, including api-key.'],
  RPC_WRONG_NETWORK:['这是其他网络的地址，请在 Helius 选择 Solana Devnet。','Wrong network. Select Solana Devnet in Helius.'],
  RPC_FACTORY_MISMATCH:['该 RPC 的合约状态不匹配，当前连接已保留。','The RPC contract state does not match. Your current connection is retained.'],
  RPC_AUTH_FAILED:['API key 不可用，请从 Helius 控制台重新复制完整地址。','The API key is unavailable. Copy the full URL again from the Helius dashboard.'],
  RPC_RATE_LIMITED:['该 RPC 暂时限流，请检查 Helius 额度后重试。','This RPC is rate limited. Check your Helius quota and retry.'],
  RPC_UNAVAILABLE:['无法连接此 RPC。请检查地址、网络及 Helius 的网站访问限制后重试。','Cannot connect. Check the URL, network and Helius website access restrictions, then retry.'],
  'sync-unavailable':['RPC 已保存，链上状态暂未刷新成功，正在重试。','RPC saved. Chain state could not refresh yet; retrying.'],
};
const node=(tag,className='')=>{const e=document.createElement(tag);if(className)e.className=className;return e;};
export class MinerRpcSettingsV4 {
  constructor({rpc,onChange=async()=>{},parent}){
    this.rpc=rpc;this.onChange=onChange;
    this.root=node('details','miner-rpc-settings');this.root.id='miner-rpc-settings';this.root.dataset.noI18n='';
    const summary=node('summary');this.title=node('span');this.mode=node('span','rpc-mode');summary.append(this.title,this.mode);
    this.intro=node('p','field-note');const steps=node('ol','rpc-guide');
    const first=node('li');this.signup=node('a');Object.assign(this.signup,{href:'https://dashboard.helius.dev/signup?plan=free',target:'_blank',rel:'noopener noreferrer'});first.append(this.signup);
    this.step2=node('li');this.step3=node('li');steps.append(first,this.step2,this.step3);
    this.form=node('form');this.form.noValidate=true;this.form.setAttribute('aria-busy','false');
    const label=node('label');label.htmlFor='miner-rpc-url';this.label=node('span');
    this.input=node('input');Object.assign(this.input,{id:'miner-rpc-url',type:'password',autocomplete:'off',spellcheck:false,maxLength:2048,placeholder:'https://devnet.helius-rpc.com/?api-key=YOUR_API_KEY'});this.input.setAttribute('autocapitalize','none');this.input.setAttribute('aria-describedby','miner-rpc-privacy miner-rpc-status');this.input.value=rpc.value;
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
    rpc.onChange=()=>this.render();this.render();
  }
  async changed(){try{await this.onChange();}catch{this.rpc.status='sync-unavailable';}}
  render(){
    const rpc=this.rpc,busy=rpc.busy||this.changing;
    this.title.textContent=say('RPC 设置','RPC settings');this.mode.textContent=rpc.busy?say('检查中','Checking'):rpc.endpoint?say('个人 Helius','Personal Helius'):say('默认共享','Shared default');
    this.intro.textContent=say('推荐使用自己的 Helius RPC，减少共享连接限流。Helius 可以免费注册；免费方案有额度限制，以其控制台为准。','Use your own Helius RPC to reduce shared connection limits. Helius offers free registration; free-plan quotas apply as shown in its dashboard.');
    this.signup.textContent=say('免费注册 Helius ↗','Register with Helius for free ↗');this.step2.textContent=say('在控制台创建 API key，选择 Solana Devnet，复制 HTTPS RPC 地址。','Create an API key in the dashboard, select Solana Devnet and copy the HTTPS RPC URL.');this.step3.textContent=say('粘贴到下方，点击“检查并使用”。请勿选择 Mainnet。','Paste it below and choose “Check and use”. Select Devnet, not Mainnet.');
    this.label.textContent=say('个人 Helius Devnet RPC 地址','Personal Helius Devnet RPC URL');this.show.textContent=this.input.type==='password'?say('显示','Show'):say('隐藏','Hide');this.show.setAttribute('aria-pressed',String(this.input.type==='text'));
    this.rememberText.textContent=say('在此浏览器记住地址','Remember in this browser');this.privacy.textContent=say('默认仅保存在当前标签页；勾选后保存在本机。地址不会发送给 flybrainwork 服务器，用于浏览器直接查询和广播交易；节点使用独立连接。','Saved only in this tab by default; remembering stores it on this device. The URL is not sent to flybrainwork servers. Your browser uses it directly for chain queries and transaction broadcasts; nodes use their own connection.');
    this.apply.textContent=busy?say('正在检查…','Checking…'):say('检查并使用','Check and use');this.reset.textContent=say('恢复默认 RPC','Use default RPC');this.form.setAttribute('aria-busy',String(!!busy));
    for(const control of [this.input,this.show,this.remember,this.apply,this.reset])control.disabled=!!busy;
    const message=text[rpc.status]||text.RPC_UNAVAILABLE;this.status.textContent=say(...message);this.status.dataset.error=String(rpc.status.startsWith('RPC_')||rpc.status.includes('unavailable'));
  }
  dispose(){this.rpc.onChange=()=>{};this.root.remove();}
}
