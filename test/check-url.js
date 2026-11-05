const http=require('node:http');
const URL = process.argv[2];
(async()=>{
  const list=await new Promise((res,rej)=>http.get({host:'127.0.0.1',port:9222,path:'/json/list'},r=>{let s='';r.on('data',d=>s+=d);r.on('end',()=>res(JSON.parse(s)))}).on('error',rej));
  const t=list.find(x=>x.type==='page');
  const ws=new WebSocket(t.webSocketDebuggerUrl);
  let id=0;const pend=new Map();const net=[];const errs=[];
  const send=(m,q={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:q}))});
  ws.onmessage=e=>{const m=JSON.parse(e.data);
    if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result);pend.delete(m.id);return}
    if(m.method==='Network.responseReceived')net.push(`${m.params.response.status} ${m.params.response.url.slice(0,110)}`);
    if(m.method==='Network.loadingFailed')net.push(`FAIL ${m.params.errorText}`);
    if(m.method==='Runtime.exceptionThrown')errs.push(String(m.params.exceptionDetails.exception&&m.params.exceptionDetails.exception.description||m.params.exceptionDetails.text).slice(0,200));
  };
  await new Promise(r=>ws.onopen=r);
  await send('Network.enable');await send('Runtime.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Page.enable');
  await send('Page.navigate',{url:URL+'?cb='+Date.now()});
  await new Promise(r=>setTimeout(r,9000));
  const r=await send('Runtime.evaluate',{expression:'JSON.stringify({url:location.href,title:document.title,h1:(document.querySelector("h1")||{}).textContent,btns:document.querySelectorAll(".group-btn").length,ice:!!window.__ice,bank:!!(window.__ice&&window.__ice.loadBank)})',returnByValue:true});
  console.log('PAGE:',r.result.value);
  const f=await send('Runtime.evaluate',{expression:`(async()=>{try{const a=await fetch('samples/bing-bank.json');const b=await fetch('samples/bing-bank.bin');return 'json='+a.status+' bin='+b.status+' bytes='+(await b.arrayBuffer()).byteLength}catch(e){return 'ERR '+e.message}})()`,awaitPromise:true,returnByValue:true});
  console.log('ASSETS:',f.result.value);
  console.log(net.slice(0,20).join('\n'));
  if(errs.length)console.log('ERRORS:',errs.join('\n'));
  ws.close();
})();
