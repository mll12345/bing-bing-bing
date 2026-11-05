const http=require('node:http');
(async()=>{
  const list=await new Promise((res,rej)=>http.get({host:'127.0.0.1',port:9222,path:'/json/list'},r=>{let s='';r.on('data',d=>s+=d);r.on('end',()=>res(JSON.parse(s)))}).on('error',rej));
  const t=list.find(x=>x.type==='page');
  const ws=new WebSocket(t.webSocketDebuggerUrl);
  let id=0;const pend=new Map();const net=[];
  const send=(m,q={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:q}))});
  ws.onmessage=e=>{const m=JSON.parse(e.data);
    if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result);pend.delete(m.id);return}
    if(m.method==='Network.responseReceived')net.push(`${m.params.response.status} ${m.params.response.url.slice(0,90)}`);
    if(m.method==='Network.loadingFailed')net.push(`FAIL ${m.params.errorText} ${m.params.requestId}`);
  };
  await new Promise(r=>ws.onopen=r);
  await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Page.enable');
  await send('Page.navigate',{url:'https://mll12345.github.io/bing-bing-bing/'});
  await new Promise(r=>setTimeout(r,8000));
  const r=await send('Runtime.evaluate',{expression:'location.href+" | title="+document.title+" | h1="+(document.querySelector("h1")?document.querySelector("h1").textContent:"NONE")',returnByValue:true});
  console.log('PAGE:',r.result.value);
  console.log(net.slice(0,25).join('\n'));
  ws.close();
})();
