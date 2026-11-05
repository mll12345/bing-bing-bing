const urls=[
 'https://cdn.jsdelivr.net/gh/mll12345/bing-bing-bing@main/',
 'https://cdn.jsdelivr.net/gh/mll12345/bing-bing-bing@main/index.html',
 'https://cdn.jsdelivr.net/gh/mll12345/bing-bing-bing@main/samples/bing-bank.bin',
 'https://fastly.jsdelivr.net/gh/mll12345/bing-bing-bing@main/index.html',
 'https://gcore.jsdelivr.net/gh/mll12345/bing-bing-bing@main/index.html',
 'https://raw.githubusercontent.com/mll12345/bing-bing-bing/main/index.html'
];
for(const u of urls){
  try{
    const r=await fetch(u,{redirect:'follow'});
    const t=await r.text();
    console.log(r.status, r.url.slice(0,70), 'len', t.length, '|', t.slice(0,40).replace(/\n/g,' '));
  }catch(e){ console.log('ERR', u, e.message); }
}
