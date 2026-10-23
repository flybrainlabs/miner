import {TaskSupplyStatusV4} from './task-supply-status-v4.mjs';

const parent=document.querySelector('#main .product-page')||document.querySelector('#main')||document.querySelector('main');
if(parent)(async()=>{
 const response=await fetch('/assets/data/task-factory-deployment-v4.json',{cache:'no-store',credentials:'omit',redirect:'error'});
 if(!response.ok)return;const deployment=await response.json();if(deployment.enabled!==true||!deployment.taskPool)return;
 const panel=new TaskSupplyStatusV4({apiBase:deployment.apiBase,parent});panel.root.className='product-result';const heading=parent.querySelector('.page-heading');if(heading)heading.after(panel.root);else parent.prepend(panel.root);panel.start();
 window.addEventListener('pagehide',event=>{if(!event.persisted)panel.dispose();});
})().catch(()=>{});
