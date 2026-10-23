import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LocalD1} from './db.mjs';
import {calculateTick,bootstrap,advanceMarket} from '../lib/engine.ts';
import {seedStocks,DAY,session} from '../lib/market-data.ts';
import {marketCycle} from '../lib/market-cycle.ts';
import {newAttribution,PRICE_MODEL_VERSION} from '../lib/price-dynamics.ts';
const start=Date.parse('2026-10-24T17:10:00+09:00'),stocks=seedStocks(),index=s=>s.filter(x=>x.kind==='stock').reduce((v,x)=>v+x.price/x.initial,0)/26*1000;

test('smaller shared noise still produces rising and falling markets and preserves individual disagreement',()=>{
 let up=0,down=0,mixed=0;const returns=[];
 for(let i=0;i<1200;i++){
  const seed=createHash('sha256').update('balanced-market-'+i).digest('hex'),next=calculateTick(stocks,[],[],start,undefined,undefined,seed),equities=next.filter(s=>s.kind==='stock');
  const r=index(next)/index(stocks)-1;returns.push(r);if(r>0)up++;if(r<0)down++;
  if(equities.some(s=>s.price>s.previous)&&equities.some(s=>s.price<s.previous))mixed++;
 }
 const mean=returns.reduce((a,b)=>a+b,0)/returns.length,sd=Math.sqrt(returns.reduce((a,b)=>a+(b-mean)**2,0)/returns.length);
 assert.ok(up>450&&down>450);assert.ok(mixed>1150);assert.ok(sd>.0005&&sd<.0025);
});

test('good and bad confirmed news retain causal price effects, while independent prices can disagree',()=>{
 const s=stocks.find(s=>s.id==='000008'),news=impact=>({id:'statement',ts:start,expires:start+DAY,stock_id:s.id,sector:null,category:'수주·계약',impact,details:'{}'});
 for(const impact of [-.015,.015]){
  const out=newAttribution(),baseline=calculateTick(stocks,[],[],start,undefined,undefined,'paired'),changed=calculateTick(stocks,[],[news(impact)],start,undefined,undefined,'paired',null,out);
  assert.ok((changed.find(x=>x.id===s.id).price-baseline.find(x=>x.id===s.id).price)*impact>0);
  assert.ok(out.factors.news*impact>0);
 }
});

test('regimes include genuinely negative drift and only a small positive long-run tendency',()=>{
 for(let i=0;i<24;i++){
  let sum=0;const phases=new Set();
  for(let d=0;d<140;d++){const c=marketCycle(start+d*DAY,'regime-balance-'+i,stocks);phases.add(c.phase);sum+=c.dailyDrift;assert.equal(c.dailyDrift<0,c.phase==='correction');}
  assert.equal(phases.size,3);assert.ok(sum/140>0&&sum/140<.001);
 }
});

test('attribution reconciles actual index changes, including news, real orders and dividend rounding',()=>{
 const at=session(start).day+(23*60+20)*60000,order={stock_id:'000008',side:'sell',qty:100,filled_qty:0};
 const out=newAttribution(),next=calculateTick(stocks,[order],[],at,undefined,undefined,'ex-date',marketCycle(at,'cycle',stocks),out);
 assert.ok(out.factors.orders<0);assert.ok(Object.values(out.factors).every(Number.isFinite));
 assert.ok(Math.abs(out.before-index(stocks))<1e-8);assert.ok(Math.abs(out.after-index(next))<1e-8);
 assert.ok(Math.abs(out.after-out.before-Object.values(out.factors).reduce((a,b)=>a+b,0)-out.other)<1e-8);
 assert.ok(next.every((s,i)=>s.shares===stocks[i].shares));
});

test('the balance change does not impose an index floor or a compulsory direction at low or high prices',()=>{
 for(const scale of [.2,5]){
  const state=stocks.map(s=>({...s,price:s.price*scale,previous:s.previous*scale,day_open:s.day_open*scale,high:s.high*scale,low:s.low*scale}));let up=0,down=0;
  for(let i=0;i<150;i++){const next=calculateTick(state,[],[],start,undefined,undefined,'level-'+i),move=index(next)-index(state);if(move>0)up++;if(move<0)down++;}
  assert.ok(up>35&&down>35);
 }
});

test('historical diagnostics commit atomically with each tick and do not duplicate on retries',async()=>{
 const db=new LocalD1();await bootstrap(db,start);db.sqlite.prepare('UPDATE market SET last_tick=?').run(start-300000);
 const old=db.sqlite.prepare('SELECT last_tick FROM market').get().last_tick;
 db.sqlite.exec("CREATE TRIGGER refuse_diagnostic BEFORE INSERT ON market_diagnostics BEGIN SELECT RAISE(ABORT,'DIAGNOSTIC_BLOCK'); END");
 await assert.rejects(advanceMarket(db,start,1),/DIAGNOSTIC_BLOCK/);assert.equal(db.sqlite.prepare('SELECT last_tick FROM market').get().last_tick,old);
 db.sqlite.exec('DROP TRIGGER refuse_diagnostic');await advanceMarket(db,start,1);
 const rows=db.sqlite.prepare('SELECT * FROM market_diagnostics').all();assert.equal(rows.length,1);assert.equal(rows[0].model,PRICE_MODEL_VERSION);
 const d=JSON.parse(rows[0].details),tick=db.sqlite.prepare('SELECT index_value FROM ticks WHERE ts=?').get(start);assert.ok(Math.abs(d.after-tick.index_value)<1e-8);
 await advanceMarket(db,start,2);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM market_diagnostics').get().n,1);
});
