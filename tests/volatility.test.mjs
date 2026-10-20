import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {calculateTick,seedStocks,priceBounds,STEP} from '../lib/engine.ts';
const start=Date.parse('2026-10-20T17:20:00+09:00');
test('higher volatility still gives both directions, occasional larger moves and enforced daily limits',()=>{
 const stocks=seedStocks();let sum=0,count=0,up=0,down=0,large=0;
 for(let i=0;i<1200;i++){
  const seed=createHash('sha256').update('volatility-'+i).digest('hex'),next=calculateTick(stocks,[],[],start,undefined,undefined,seed);
  for(const s of next.filter(s=>s.kind==='stock')){
   const r=s.price/stocks.find(x=>x.id===s.id).price-1;sum+=r*r;count++;if(r>0)up++;if(r<0)down++;if(Math.abs(r)>.025)large++;
   const bounds=priceBounds(s.previous);assert.ok(s.price>=bounds.lower&&s.price<=bounds.upper);
  }
 }
 const rms=Math.sqrt(sum/count);assert.ok(rms>.009&&rms<.014);assert.ok(up/count>.4);assert.ok(down/count>.4);assert.ok(large/count>.005&&large/count<.08);
});
