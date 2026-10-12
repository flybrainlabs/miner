"""Check removed header space and inline rate typography, without mining.

The requested example string is displayed temporarily for layout measurement;
it is not a measured throughput or scientific execution.
"""
import argparse,json
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.support.ui import WebDriverWait
from browser_cache import retained_profile,close_test_browser
from e2e_official_download import BrowserNetwork
p=argparse.ArgumentParser();p.add_argument('--site',required=True);p.add_argument('--report',required=True);a=p.parse_args()
out=Path(a.report);out.parent.mkdir(parents=True,exist_ok=True);report={'schema':'compact-console-layout-v1','site':a.site,'retainedProfile':True,'physicalAndroid':False,'rateExample':'3.18 M supplied for typography only; not measured work','layouts':[]}
with retained_profile() as profile:
 o=webdriver.ChromeOptions();o.binary_location='/usr/bin/chromium'
 for arg in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--user-data-dir='+profile,'--window-size=1440,1050']:o.add_argument(arg)
 o.set_capability('goog:loggingPrefs',{'browser':'ALL'});d=webdriver.Chrome(options=o);js=d.execute_script;wait=WebDriverWait(d,90,poll_frequency=.25);net=BrowserNetwork(d)
 try:
  d.get(a.site.rstrip('/')+'/mining/');wait.until(lambda _:js("return window.flypowWorkspace?.snapshot().preparation!=='checking' && !!window.flypowWorkspace"))
  for lang in ['zh','en']:
   for width in [320,390,1440]:
    d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':width,'height':1050,'deviceScaleFactor':1,'mobile':False})
    layout=js("""
      FlyI18n.setLanguage(arguments[0]);
      const panel=document.querySelector('.miner-primary-panel'),tabs=document.querySelector('.miner-step-tabs'),style=getComputedStyle(panel);
      const headerGap=tabs.getBoundingClientRect().top-panel.getBoundingClientRect().top-parseFloat(style.paddingTop)-parseFloat(style.borderTopWidth);
      const initial=flypowWorkspace.snapshot();
      document.getElementById('miner-stage-mining').hidden=false;document.getElementById('miner-computation').hidden=false;
      const value=document.getElementById('miner-compute-neurons');value.textContent='3.18 M';
      const row=document.querySelector('.miner-current-metrics'),items=[...row.children].map(e=>({text:e.innerText,top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,width:e.clientWidth,scroll:e.scrollWidth}));
      return {width:innerWidth,language:arguments[0],headerGap,headerPresent:!!document.querySelector('.console-heading,#miner-network-badge'),running:initial.running,ready:initial.ready,items,documentWidth:document.documentElement.scrollWidth,oneLine:Math.max(...items.map(e=>e.top))<Math.min(...items.map(e=>e.bottom))};
    """,lang)
    assert abs(layout['headerGap'])<1 and not layout['headerPresent'],layout
    assert layout['oneLine'] and layout['items'][1]['scroll']<=layout['items'][1]['width']+1 and layout['items'][2]['scroll']<=layout['items'][2]['width']+1,layout
    assert layout['documentWidth']<=width+1 and not layout['running'] and not layout['ready'],layout
    report['layouts'].append(layout)
  d.refresh();wait.until(lambda _:js("return !!window.flypowWorkspace && flypowWorkspace.snapshot().preparation!=='checking'"));js("FlyI18n.setLanguage('zh')");d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':390,'height':1050,'deviceScaleFactor':1,'mobile':False})
  image=out.parent/'actual-console-zh-390.png';d.save_screenshot(str(image));report['actualPageScreenshot']=str(image)
  report['socialLinks']=[]
  for path in ['/','/mining/','/explorer/']:
   d.get(a.site.rstrip('/')+path);wait.until(lambda _:js("return !!window.FlyI18n && !!document.querySelector('.site-social-link svg')"));js("return FlyI18n.ready")
   for width in [390,1440]:
    d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':width,'height':1050,'deviceScaleFactor':1,'mobile':False})
    social=js("""
      const links=document.querySelectorAll('a[href="https://x.com/flybrainwork"]'),link=links[0],icon=link?.querySelector('svg'),rect=icon?.getBoundingClientRect();
      return {path:location.pathname,width:innerWidth,count:links.length,href:link?.href,label:link?.getAttribute('aria-label'),target:link?.target,rel:link?.rel,iconWidth:rect?.width,iconHeight:rect?.height,iconHidden:icon?.getAttribute('aria-hidden'),hasPath:!!icon?.querySelector('path'),text:link?.textContent.trim(),documentWidth:document.documentElement.scrollWidth};
    """)
    assert social['count']==1 and social['href']=='https://x.com/flybrainwork' and social['label']=='flybrainwork on X',social
    assert social['target']=='_blank' and {'noopener','noreferrer'}<=set(social['rel'].split()),social
    assert social['hasPath'] and social['iconHidden']=='true' and social['text']=='' and social['iconWidth']>=20 and social['iconHeight']>=20,social
    assert social['documentWidth']<=width+1,social
    report['socialLinks'].append(social)
  report['officialDownload']={'officialRequests':len(net.requests),'officialReceivedBytes':net.data_received_bytes};assert len(net.requests)==0;report['passed']=True
  print(json.dumps({'passed':True,'layouts':len(report['layouts']),'headerGapMax':max(abs(r['headerGap']) for r in report['layouts']),'rateOnOneLine':True,'socialLinks':len(report['socialLinks']),'officialRequests':len(net.requests)}),flush=True)
 finally:
  report['browserErrors']=[r['message'][:300] for r in d.get_log('browser') if r['level']=='SEVERE'];out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');close_test_browser(d)
