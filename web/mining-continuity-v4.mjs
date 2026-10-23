const messages={
  en:'Mining continues in this tab when you switch tabs. While it is running, other site pages open in a new tab. Keep this tab and browser open; device sleep or browser suspension can interrupt computation.',
  zh:'切换标签页后，本页继续挖矿。运行期间，其他站内页面会在新标签页打开。请保留本页和浏览器；设备休眠或浏览器冻结可能中断计算。',
  fr:'Le minage continue dans cet onglet lorsque vous changez d’onglet. Pendant son exécution, les autres pages du site s’ouvrent dans un nouvel onglet. Gardez cet onglet et le navigateur ouverts ; la veille ou la suspension du navigateur peut interrompre le calcul.',
  ru:'Майнинг продолжается в этой вкладке при переключении вкладок. Во время работы другие страницы сайта открываются в новой вкладке. Не закрывайте эту вкладку и браузер: сон устройства или приостановка браузера могут прервать вычисления.',
  ja:'タブを切り替えても、このタブでマイニングを続行します。実行中はサイト内の別ページを新しいタブで開きます。このタブとブラウザーを開いたままにしてください。端末のスリープやブラウザーによる停止で計算が中断する場合があります。',
  ko:'탭을 전환해도 이 탭에서 채굴을 계속합니다. 실행 중에는 사이트의 다른 페이지가 새 탭에서 열립니다. 이 탭과 브라우저를 열어 두세요. 기기 절전이나 브라우저 정지로 계산이 중단될 수 있습니다.'
};

// Keep the document that owns the Workers and unlocked wallet alive. Browser
// suspension and closing the document remain real execution boundaries.
export class MiningContinuityV4 {
  constructor({active,document=globalThis.document,window=globalThis.window}){
    Object.assign(this,{active,document,window});
    this.note=document.createElement('p');this.note.id='miner-background-status';
    this.note.className='miner-guidance';this.note.dataset.noI18n='';this.note.hidden=true;
    document.getElementById('miner-guidance')?.after(this.note);
    this.click=event=>this.retainDocument(event);
    this.language=()=>this.render();document.addEventListener('click',this.click,true);
    document.addEventListener('flypow:language',this.language);this.render();
  }
  retainDocument(event){
    if(!this.active()||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    const link=event.target?.closest?.('a[href]');
    if(!link||link.hasAttribute('download')||link.target&&!['_self'].includes(link.target))return;
    const url=new URL(link.href,this.window.location.href),current=new URL(this.window.location.href);
    if(url.origin!==current.origin||!['http:','https:'].includes(url.protocol)||url.pathname===current.pathname||/^\/mining\/?$/.test(url.pathname)||/^\/(?:assets|api|auth)(?:\/|$)/.test(url.pathname))return;
    // Use the user's actual link click so popup blocking cannot replace this
    // page with a fallback navigation and destroy the mining session.
    const target=link.getAttribute('target'),rel=link.getAttribute('rel');
    link.target='_blank';link.rel=[...(new Set([...(rel||'').split(/\s+/).filter(Boolean),'noopener']))].join(' ');
    this.window.setTimeout(()=>{if(target===null)link.removeAttribute('target');else link.setAttribute('target',target);if(rel===null)link.removeAttribute('rel');else link.setAttribute('rel',rel);},0);
  }
  render(){this.note.hidden=!this.active();const language=this.window.FlyI18n?.language||'en',text=messages[language]||messages.en;if(this.note.textContent!==text)this.note.textContent=text;}
  dispose(){this.document.removeEventListener('click',this.click,true);this.document.removeEventListener('flypow:language',this.language);this.note.remove();}
}
