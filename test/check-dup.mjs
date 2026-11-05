import fs from 'node:fs';
const files=['src/fft.js','src/pcm.js','src/dsp.js','src/vocals.js','src/voice.js','src/reslice.js','src/bank.js','src/engine.js','src/audio.js','src/main.js'];
const seen=new Map();
for(const f of files){
  const src=fs.readFileSync(f,'utf8');
  const re=/^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while((m=re.exec(src))){
    const n=m[1];
    if(seen.has(n)) console.log('DUP',n,'in',f,'and',seen.get(n));
    else seen.set(n,f);
  }
}
console.log('top-level names',seen.size);
