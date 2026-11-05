const http=require('http');
const getJSON=(p)=>new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:9222,path:p},(r)=>{let s='';r.on('data',d=>s+=d);r.on('end',()=>{try{res(JSON.parse(s))}catch(e){rej(e)}})}).on('error',rej)});
(async()=>{
 const list=await getJSON('/json/list');const t=list.find(x=>x.type==='page');
 const ws=new WebSocket(t.webSocketDebuggerUrl);let id=0;const p=new Map();
 const send=(m,q={})=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:q}))});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&p.has(m.id)){p.get(m.id)(m.result);p.delete(m.id)}};
 await new Promise(r=>ws.onopen=r);
 const r=await send('Runtime.evaluate',{expression:`JSON.stringify(['waveIn','waveOut','videoCanvas'].map(id=>{const e=document.getElementById(id);const r=e.getBoundingClientRect();return {id,w:r.width,h:r.height,attr:[e.width,e.height],cs:getComputedStyle(e).height}}))`,returnByValue:true});
 console.log(r.result.value);
 ws.close();process.exit(0);
})();
