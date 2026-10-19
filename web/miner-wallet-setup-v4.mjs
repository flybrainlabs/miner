import {say} from './goal-status-text.mjs';
import {MiningWalletV4,MiningWalletPolicyV4,newMiningMnemonic} from '/assets/vendor/generated/factory-wallet-v4.mjs';
const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
const sol=value=>{const n=BigInt(value||0),fraction=(n%1000000000n).toString().padStart(9,'0').replace(/0+$/,'');return (n/1000000000n).toString()+(fraction?'.'+fraction:'');};
const messages={
  MINING_WALLET_PHRASE:['助记词格式或校验不正确，请核对顺序与拼写。','Check the recovery phrase, word order and spelling.'],
  MINING_WALLET_BACKUP:['请先离线保存助记词，再正确填写指定的三个词。','Save your phrase offline, then enter the three requested words.'],
  MINING_WALLET_PASSWORD_LENGTH:['本机加密密码至少需要 12 个字符。','The local encryption password needs at least 12 characters.'],
  MINING_WALLET_PASSWORD_MATCH:['两次输入的密码不一致，请重新核对。','The two passwords do not match.'],
  MINING_WALLET_UNLOCK:['无法解锁，请核对本机密码；也可使用助记词恢复。','Unable to unlock. Check the local password or restore with your phrase.'],
  MINING_WALLET_STORAGE:['浏览器未能保存加密钱包。请保留助记词并检查存储权限。','The browser could not save the encrypted wallet. Keep your phrase and check storage permission.'],
  MINING_WALLET_BALANCE:['SOL 不足，请向下方地址转入当前网络的 SOL 后刷新余额。','Insufficient SOL. Fund the address on the displayed network, then refresh.'],
  MINING_WALLET_APPROVAL:['请先启用当前挖矿合约的自动支付。','Enable automatic payments for the current mining contract first.'],
  MINING_WALLET_LOCKED:['专用钱包已锁定，挖矿支付已停止。请用本机密码解锁。','The mining wallet is locked and payments stopped. Unlock with your local password.'],
  MINING_WALLET_CHALLENGE:['登录消息不符合本站和当前网络，已拒绝签名。','The login message differs from this site or network; signing was refused.'],
  MINING_WALLET_TRANSACTION:['交易超出当前挖矿合约范围，已拒绝签名。','The transaction is outside this mining contract; signing was refused.'],
  MINING_WALLET_FEE:['网络手续费超出允许范围，已暂停支付。','The network fee exceeds the allowed ceiling; payments stopped.'],
  RPC_REQUIRED:['请先验证自己的 Helius API Key，才能读取余额与租金。','Verify your personal Helius API key before reading balances and rent.']
};
export class MinerWalletSetupV4 {
  constructor({deployment,financial,adapter,parent,onChange=()=>{},onNeedRpc=()=>{},onLock=()=>{}}){
    Object.assign(this,{deployment,financial,adapter,onChange,onNeedRpc,onLock});this.vault=new MiningWalletV4({deployment});this.mode='intro';this.phrase=null;this.revealed=false;this.busy=false;this.error=null;this.quoteValue=null;
    this.root=el('details','','mining-wallet-setup');this.root.id='mining-wallet-setup';this.root.dataset.noI18n='';this.root.open=true;
    const summary=el('summary');this.title=el('strong');this.status=el('span','','mining-wallet-badge');summary.append(this.title,this.status);
    this.rail=el('ol','','mining-wallet-rail');this.body=el('div','','mining-wallet-body');this.note=el('p','','mining-wallet-feedback');this.note.id='mining-wallet-feedback';this.note.setAttribute('role','status');this.note.setAttribute('aria-live','polite');this.root.append(summary,this.rail,this.body,this.note);parent.before(this.root);
    const href=new URL('./miner-wallet-setup-v4.css',import.meta.url);href.search=new URL(import.meta.url).search;
    if(!document.getElementById('mining-wallet-style')){const link=el('link');link.id='mining-wallet-style';link.rel='stylesheet';link.href=href.href;document.head.append(link);}
    this.vault.addEventListener('change',()=>{this.render();onChange();});
    financial.miningWalletControls={open:()=>this.focus(),lock:()=>this.lock(),state:()=>this.state()};
    this.visibility=()=>{if(document.hidden&&this.mode==='backup'){this.revealed=false;this.bodyKey=null;this.render();}};document.addEventListener('visibilitychange',this.visibility);
    this.timer=setInterval(()=>{if(document.hidden||!this.vault.unlocked||!adapter.rpc.ready)return;if(this.policy?.approved)this.ensureSession().catch(error=>this.failed(error));if(Date.now()-(this.quoteAt||0)>30000)this.refreshQuote().catch(()=>{});},5000);
  }
  async initialize(){try{await this.vault.initialize();this.mode=this.vault.exists?'unlock':'intro';}catch(error){this.mode='restore';this.error=error.code||'MINING_WALLET_STORAGE';}this.render();}
  get ready(){return this.vault.unlocked&&this.financial.account?.address===this.vault.address&&this.adapter.isSignedIn()&&!!this.policy?.approved;}
  get canMine(){if(!this.ready)return false;try{this.policy.assertCanMine();return true;}catch{return false;}}
  get requiresUnlock(){return !this.vault.exists||!this.vault.unlocked;}
  state(){return {exists:this.vault.exists,unlocked:this.vault.unlocked,ready:this.ready,busy:this.busy,address:this.vault.address,authorization:this.policy?.toJSON()||null};}
  failed(error){this.error=error.code||'MINING_WALLET_RETRY';this.render();this.onChange();}
  async operate(fn){if(this.busy)return;this.busy=true;this.error=null;this.render();this.onChange();try{await fn();}catch(error){this.failed(error);}finally{this.busy=false;this.render();this.onChange();}}
  focus(){this.root.open=true;this.root.scrollIntoView({block:'start',behavior:'smooth'});this.body.querySelector('input,textarea,button')?.focus({preventScroll:true});}
  lock(){this.onLock();this.vault.lock();if(this.financial.account?.address===this.vault.address)this.financial.clearLogin();this.mode='unlock';this.bodyKey=null;this.render();}
  button(text,fn,cls='button button-ghost'){const n=el('button',text,cls);n.type='button';n.onclick=()=>this.operate(fn);return n;}
  field(label,type='password',id=''){const host=el('label',label),input=el('input');input.type=type;if(id)input.id=id;input.autocomplete=type==='password'?'new-password':'off';input.spellcheck=false;input.setAttribute('autocapitalize','none');host.append(input);return {host,input};}
  async ensureSession(){
    if(this.sessionPending)return this.sessionPending;
    this.sessionPending=(async()=>{this.vault.assertUnlocked();this.adapter.rpc.assertReady();
      if(!this.policy||this.policy.address!==this.vault.address){this.policy=new MiningWalletPolicyV4({deployment:this.deployment,connection:this.adapter.connection,address:this.vault.address});this.vault.policy=this.policy;this.policy.addEventListener('change',()=>{this.render();this.onChange();});}
      const provider=this.vault.provider();if(this.financial.wallet!==provider||this.financial.account?.address!==this.vault.address)await this.financial.connect(provider);
      if(!this.adapter.isSignedIn()||Number(this.financial.login.expiresAt)<Date.now()/1000+120)await this.financial.signIn();
    })().finally(()=>this.sessionPending=null);return this.sessionPending;
  }
  async connected(){if(!this.vault.unlocked||!this.adapter.rpc.ready)return;await this.ensureSession();await this.refreshQuote();}
  async refreshQuote(){
    if(this.quoting)return;this.quoting=true;
    try{await this.ensureSession();this.quoteValue=await this.policy.quote();this.quoteAt=Date.now();this.render();this.onChange();}finally{this.quoting=false;}
  }
  costs(){
    const box=el('aside','','mining-wallet-costs');box.append(el('p',say('费用去向','WHERE YOUR SOL GOES'),'mining-wallet-eyebrow'),el('h3',say('这些费用不支付给项目团队','These costs do not go to the project team')));
    for(const [title,copy]of [
      [say('01 · SOL 留在你的钱包','01 · Your wallet holds the SOL'),say('请转入你创建的专用钱包地址。只有实际链上操作才会使用其中的 SOL。','Fund your own mining wallet address. SOL is used only when an actual on-chain operation occurs.')],
      [say('02 · PDA 租金押金','02 · PDA rent deposit'),say('创建结果账户时，Solana 要求存入免租押金，锁在该链上账户内。它不是团队收入。仅合约支持关闭账户时才能取回；当前提交账户未提供取回功能。','Solana requires a rent-exemption deposit when creating a result account. It stays in that on-chain account, rather than becoming team revenue. Reclaiming requires contract support for closing the account; current submission accounts have no reclaim feature.')],
      [say('03 · Solana 网络手续费','03 · Solana network fees'),say('交易手续费由 Solana 网络收取，通常不可退。项目团队不收取上述两项费用。','Transaction fees are charged by the Solana network and are generally nonrefundable. The project team does not collect either cost.')]
    ]){const row=el('div');row.append(el('strong',title),el('p',copy));box.append(row);}return box;
  }
  intro(){
    const grid=el('div','','mining-wallet-columns'),main=el('div');main.append(el('p',say('为挖矿单独准备的钱包','A WALLET JUST FOR MINING'),'mining-wallet-eyebrow'),el('h2',say('一次准备，链上成本自动支付','Set up once. Pay chain costs automatically.')),el('p',say('频繁的钱包插件确认可能打断提交。专用钱包在本机签名，只为当前挖矿合约支付链上成本；你的日常钱包无需反复连接。','Repeated extension prompts can interrupt submissions. This dedicated wallet signs on your device and pays chain costs only for the current mining contract. Your everyday wallet can stay separate.')));
    const actions=el('div','','mining-wallet-actions');actions.append(this.button(say('创建挖矿钱包','Create mining wallet'),async()=>{this.phrase=newMiningMnemonic();this.indices=[];while(this.indices.length<3){const n=crypto.getRandomValues(new Uint32Array(1))[0]%12;if(!this.indices.includes(n))this.indices.push(n);}this.indices.sort((a,b)=>a-b);this.revealed=false;this.mode='backup';this.bodyKey=null;},'button'),this.button(say('用助记词恢复','Restore with recovery phrase'),async()=>{this.mode='restore';this.bodyKey=null;}));main.append(actions,el('p',say('助记词只在本机生成。项目团队不会索取、上传或代存。','The phrase is generated on your device. The project team does not request, upload or keep it.'),'field-note'));grid.append(main,this.costs());this.body.append(grid);
  }
  backup(){
    this.body.append(el('h2',say('先离线保存这 12 个词','First, save these 12 words offline')),el('p',say('助记词是恢复钱包和资金的凭证。按顺序抄写并妥善保管；不要发给任何人。丢失助记词后，团队无法帮你恢复钱包。','Your phrase restores this wallet and its funds. Write the words in order and keep them private. The team cannot restore a lost phrase.')));
    const words=el('ol','','mining-wallet-words');words.dataset.sensitive='true';words.id='mining-wallet-words';
    for(const [i,word]of this.phrase.split(' ').entries()){const item=el('li');item.append(el('span',String(i+1).padStart(2,'0')),el('strong',this.revealed?word:'••••••'));words.append(item);}this.body.append(words);
    const saved=el('label','','mining-wallet-consent'),checkbox=el('input');checkbox.type='checkbox';checkbox.id='mining-wallet-saved';saved.append(checkbox,el('span',say('我已按顺序离线保存，并理解助记词可控制钱包内的资金。','I saved the words offline in order and understand that they control this wallet.')));
    const actions=el('div','','mining-wallet-actions');actions.append(this.button(this.revealed?say('隐藏助记词','Hide phrase'):say('显示助记词','Reveal phrase'),async()=>{this.revealed=!this.revealed;this.bodyKey=null;}),this.button(say('已保存，验证备份','Saved — verify backup'),async()=>{if(!checkbox.checked||!this.revealed)throw {code:'MINING_WALLET_BACKUP'};this.mode='verify';this.revealed=false;this.bodyKey=null;},'button'));
    this.body.append(saved,actions);
  }
  phraseForm(restore){
    this.body.append(el('h2',restore?say('恢复专用挖矿钱包','Restore your mining wallet'):say('验证备份并加密本机副本','Verify your backup and encrypt the local copy')));
    const form=el('form');form.autocomplete='off';const answers=[];let phrase;
    if(restore){this.body.append(el('p',say('仅在此输入你的专用挖矿钱包助记词。支持 12 或 24 个英文词。原有加密钱包会保留，不会删除模型或结果。','Use only your dedicated mining-wallet phrase here: 12 or 24 English words. Existing encrypted wallets, models and results are retained.')));const label=el('label',say('助记词（按原顺序）','Recovery phrase (original order)'));phrase=el('textarea');phrase.id='mining-wallet-restore-phrase';phrase.autocomplete='off';phrase.spellcheck=false;phrase.setAttribute('autocapitalize','none');phrase.dataset.sensitive='true';phrase.required=true;label.append(phrase);form.append(label);}
    else{const grid=el('div','','mining-wallet-quiz');for(const index of this.indices){const field=this.field(say(`第 ${index+1} 个词`,`Word ${index+1}`),'text','mining-wallet-word-'+index);field.input.required=true;field.input.dataset.sensitive='true';answers.push(field.input);grid.append(field.host);}form.append(grid);}
    const password=this.field(say('本机加密密码（至少 12 个字符）','Local encryption password (at least 12 characters)'),'password','mining-wallet-password'),repeat=this.field(say('再次输入密码','Confirm password'),'password','mining-wallet-password-confirm');password.input.required=repeat.input.required=true;password.input.minLength=repeat.input.minLength=12;form.append(password.host,repeat.host,el('p',say('密码用于加密本浏览器的钱包副本，不改变助记词。刷新后需解锁；忘记密码可用助记词恢复。','This password encrypts the browser copy and does not change your phrase. Unlock after reload; use your phrase if the password is lost.'),'field-note'));
    const confirmation=el('label','','mining-wallet-consent'),consent=el('input');consent.type='checkbox';consent.id='mining-wallet-backup-confirm';consent.required=true;confirmation.append(consent,el('span',say('我已安全保存助记词，明白团队无法代为找回。','I have securely saved the phrase and understand the team cannot recover it.')));form.append(confirmation);
    const submit=el('button',restore?say('恢复并加密钱包','Restore and encrypt wallet'):say('确认备份，创建钱包','Confirm backup and create wallet'),'button');submit.id='mining-wallet-save';submit.type='submit';form.append(submit);
    form.onsubmit=event=>{event.preventDefault();this.operate(async()=>{if(password.input.value!==repeat.input.value)throw {code:'MINING_WALLET_PASSWORD_MATCH'};await this.vault.save(restore?phrase.value:this.phrase,password.input.value,{confirmed:consent.checked,restored:restore,indices:this.indices,answers:answers.map(n=>n.value)});password.input.value=repeat.input.value='';if(phrase)phrase.value='';this.phrase=null;this.mode='fund';this.bodyKey=null;if(this.adapter.rpc.ready)await this.connected();});};this.body.append(form,this.button(say('返回','Back'),async()=>{this.mode=restore?(this.vault.exists?'unlock':'intro'):'backup';this.bodyKey=null;}));
  }
  unlock(){
    this.body.append(el('h2',say('解锁专用挖矿钱包','Unlock your mining wallet')),el('p',say('本浏览器中只保存加密副本。解锁后启用自动支付，再点击“开始挖矿”。','Only an encrypted copy is saved here. Enable automatic payments after unlocking, then select Start mining.')));
    if(this.vault.address)this.body.append(el('code',this.vault.address,'mining-wallet-address'));
    const form=el('form'),password=this.field(say('本机加密密码','Local encryption password'),'password','mining-wallet-unlock-password');password.input.autocomplete='current-password';password.input.required=true;form.append(password.host);const button=el('button',say('解锁钱包','Unlock wallet'),'button');button.id='mining-wallet-unlock';button.type='submit';form.append(button);form.onsubmit=event=>{event.preventDefault();this.operate(async()=>{await this.vault.unlock(password.input.value);password.input.value='';this.mode='fund';this.bodyKey=null;if(this.adapter.rpc.ready)await this.connected();});};this.body.append(form,this.button(say('忘记密码？用助记词恢复','Forgot password? Restore with your phrase'),async()=>{this.mode='restore';this.bodyKey=null;}));
  }
  funding(){
    const grid=el('div','','mining-wallet-columns'),main=el('div');main.append(el('h2',say('转入 SOL，用于链上租金与手续费','Fund on-chain rent and transaction fees')));
    main.append(el('p',say('当前为 Solana Devnet，仅使用测试 SOL。请勿转入主网 SOL；网络由本站部署自动选择。','Currently Solana Devnet: use test SOL only. Do not send Mainnet SOL. The site selects its deployed network automatically.'),'mining-wallet-network'));
    main.append(el('p',say('未使用的 SOL 仍由你控制。可用已备份的助记词在兼容的 Solana 钱包中恢复此地址并转出；PDA 中已锁定的押金不属于钱包可用余额。','Unused SOL remains yours. Restore this address in a compatible Solana wallet with your saved phrase to transfer it. Deposits already locked in PDAs are separate from the available wallet balance.'),'field-note'));
    main.append(el('p',say('你的专用钱包收款地址','Your mining-wallet deposit address'),'mining-wallet-eyebrow'),el('code',this.vault.address,'mining-wallet-address'));
    const actions=el('div','','mining-wallet-actions');actions.append(this.button(say('复制地址','Copy address'),async()=>{await navigator.clipboard.writeText(this.vault.address);this.note.textContent=say('已复制公开收款地址。','Public deposit address copied.');}),this.button(say('刷新余额与租金','Refresh balance and rent'),()=>this.refreshQuote()));
    const history=el('a',say('查看链上资金与交易 ↗','View funds and transactions ↗'));history.href='https://explorer.solana.com/address/'+this.vault.address+'?cluster=devnet';history.target='_blank';history.rel='noopener noreferrer';actions.append(history);main.append(actions);
    this.quoteHost=el('dl','','mining-wallet-quote');main.append(this.quoteHost);
    main.append(el('p',say('仅在创建新的提交 PDA 时扣除这笔租金押金，普通计算步骤不扣这笔费用。实际交易还需 Solana 网络手续费，领取奖励时可能需要创建代币账户的押金。所有链上成本从此钱包自动扣除，不设支出预算上限；余额不足时暂停。','The rent deposit is charged only when a new submission PDA is created, not for each computation step. Transactions also incur Solana network fees; receiving rewards may require a token-account deposit. Chain costs are deducted automatically from this wallet without a spending budget; low funds pause mining.'),'field-note'));
    const form=el('form');
    const consent=el('label','','mining-wallet-consent');this.approval=el('input');this.approval.type='checkbox';this.approval.id='mining-wallet-approval';this.approval.required=true;consent.append(this.approval,el('span',say('允许此钱包自动支付当前挖矿合约的账户押金与网络手续费，不设置预算上限。锁定钱包可停止新签名与发送，已广播交易仍可能确认。授权在本浏览器解锁期间有效，锁定或刷新后失效。','Allow this wallet to pay account deposits and network fees automatically for the current mining contract, without a spending budget. Lock the wallet to stop new signatures and sends; broadcast transactions can still confirm. Authorization lasts while this browser wallet is unlocked; locking or reloading revokes it.')));form.append(consent);
    this.enable=el('button',say('启用自动支付','Enable automatic payments'),'button');this.enable.id='mining-wallet-enable';this.enable.type='submit';form.append(this.enable);form.onsubmit=event=>{event.preventDefault();this.operate(async()=>{if(!this.approval.checked)throw {code:'MINING_WALLET_APPROVAL'};await this.ensureSession();await this.policy.approve();this.root.open=false;document.getElementById('miner-primary')?.focus();});};main.append(form);
    this.approvedNote=el('p','','mining-wallet-approved');main.append(this.approvedNote);
    main.append(this.button(say('锁定钱包并停止支付','Lock wallet and stop payments'),async()=>this.lock()));grid.append(main,this.costs());this.body.append(grid);
  }
  render(){
    this.title.textContent=say('专用挖矿钱包','Dedicated mining wallet');this.status.textContent=this.canMine?say('已就绪 · 自动支付已授权','Ready · payments authorized'):this.vault.unlocked?say('待转入 SOL / 启用支付','Fund / enable payments'):this.vault.exists?say('已加密 · 待解锁','Encrypted · locked'):say('开始前设置','Set up before mining');
    this.rail.replaceChildren(...[say('创建钱包','Create wallet'),say('备份助记词','Back up phrase'),say('转入 SOL','Fund with SOL'),say('开始挖矿','Start mining')].map((s,i)=>{const n=el('li',`${i+1}  ${s}`);n.dataset.complete=String(this.vault.exists&&i<2||this.ready&&i===2);return n;}));
    if(this.vault.unlocked&&['intro','unlock'].includes(this.mode))this.mode='fund';
    const key=[this.mode,document.documentElement.lang,this.vault.address].join(':');
    if(key!==this.bodyKey){this.focusPending||=this.root.contains(document.activeElement);this.body.replaceChildren();this.quoteHost=null;this.enable=null;this.bodyKey=key;({intro:()=>this.intro(),backup:()=>this.backup(),verify:()=>this.phraseForm(false),restore:()=>this.phraseForm(true),unlock:()=>this.unlock(),fund:()=>this.funding()})[this.mode]();}
    if(this.quoteHost){const q=this.quoteValue;this.quoteHost.replaceChildren();for(const [term,value]of [[say('可用余额','Available balance'),q?sol(q.balanceLamports)+' SOL':'—'],[say('每个新提交 PDA 的租金押金','Rent deposit per new submission PDA'),q?sol(q.submissionRentLamports)+' SOL':'—']])this.quoteHost.append(el('dt',term),el('dd',value));
      if(!q)this.quoteHost.append(el('p',say('验证个人 RPC 后获取实时报价。','Verify your personal RPC for a live quote.')));
      this.approvedNote.textContent=this.policy?.approved?say('自动支付已启用，不设预算上限。点击下方“开始挖矿”后运行。','Automatic payments enabled without a spending budget. Select Start mining below to run.'):say('转入 SOL 不会开始挖矿。启用自动支付后，再点击“开始挖矿”。','Funding does not start mining. Enable automatic payments, then select Start mining.');}
    for(const input of this.body.querySelectorAll('input,textarea,button'))input.disabled=this.busy;
    if(this.enable)this.enable.disabled=this.busy||!this.adapter.rpc.ready||!this.quoteValue;
    if(this.focusPending&&!this.busy){this.focusPending=false;if(this.root.open&&(document.activeElement===document.body||this.root.contains(document.activeElement))){const target=['verify','restore','unlock'].includes(this.mode)?this.body.querySelector('input,textarea'):this.body.querySelector('h2');if(target){if(target.tagName==='H2')target.tabIndex=-1;target.focus();}}}
    this.root.setAttribute('aria-busy',String(this.busy));this.note.textContent=this.error?say(...(messages[this.error]||['操作未完成，请检查个人 RPC 与网络后重试。','Operation incomplete. Check your personal RPC and network, then retry.'])):this.busy?say('正在本机处理，请稍候…','Processing on this device…'):'';
  }
  dispose(){clearInterval(this.timer);document.removeEventListener('visibilitychange',this.visibility);this.phrase=null;this.vault.lock();this.financial.miningWalletControls=null;this.root.remove();}
}
