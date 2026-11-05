const CDP='http://127.0.0.1:9222';
(async()=>{
 const t=(await (await fetch(CDP+'/json/list')).json()).filter(x=>x.type==='page'&&x.url.includes('8199'))[0];
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const p=new Map();
 const send=(m,pr={})=>new Promise((res,rej)=>{const i=++id;p.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:pr}))});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&p.has(m.id)){const q=p.get(m.id);p.delete(m.id); m.error?q.rej(new Error(m.error.message)):q.res(m.result);}});
 await new Promise(r=>ws.addEventListener('open',r));
 await send('Runtime.enable');
 const r=await send('Runtime.evaluate',{expression:`(()=>{
   const b=window.__ice.state.outBuffer; if(!b) return 'no out';
   const L=b.getChannelData(0), R=b.getChannelData(1);
   let eM=0,eS=0,eL=0,eR=0,r0=0,r1=0;
   for(let i=0;i<b.length;i+=5){const m=(L[i]+R[i])/2,s=(L[i]-R[i])/2;eM+=m*m;eS+=s*s;eL+=L[i]*L[i];eR+=R[i]*R[i];r0+=L[i];r1+=R[i];}
   return JSON.stringify({ch:b.numberOfChannels,len:b.length,sidePct:(100*eS/(eM+eS)).toFixed(2),Lrms:Math.sqrt(eL/(b.length/5)).toFixed(4),Rrms:Math.sqrt(eR/(b.length/5)).toFixed(4),dcL:(r0/(b.length/5)).toFixed(5)});
 })()`,returnByValue:true});
 console.log(r.result.value||JSON.stringify(r.exceptionDetails));
 ws.close();
})();
