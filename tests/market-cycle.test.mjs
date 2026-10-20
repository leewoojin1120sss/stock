import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LocalD1} from './db.mjs';
import {bootstrap,advanceMarket,calculateTick,snapshot} from '../lib/engine.ts';
import {marketCycle,cycleArticles,cycleMove,CYCLE_MODEL_START} from '../lib/market-cycle.ts';
import {marketRandom,seedStocks,DAY,session,auctionsInSession} from '../lib/market-data.ts';
const stocks=seedStocks(),equities=stocks.filter(s=>s.kind==='stock'),start=Date.parse('2026-10-21T16:40:00+09:00');
test('similar symbol IDs no longer turn independent company noise into a common market shock',()=>{
 let portfolio=0,individual=0;for(let i=0;i<2000;i++){const seed=createHash('sha256').update('correlation-'+i).digest('hex'),values=equities.map(s=>marketRandom(seed+'1792499400000'+s.id)-.5),mean=values.reduce((a,b)=>a+b,0)/26;portfolio+=mean*mean;individual+=values.reduce((a,b)=>a+b*b,0)/26;}
 const inflation=portfolio/(individual/26);assert.ok(inflation>.7&&inflation<1.4);
});
test('persistent regimes alternate, retain a positive long-run drift and rotate winners without lifting every stock',()=>{
 assert.equal(marketCycle(CYCLE_MODEL_START-1,'cycle-test',stocks),null);
 let drift=0;const phases=new Set();
 for(let day=0;day<56;day++){const at=start+day*DAY,cycle=marketCycle(at,'cycle-test',stocks);phases.add(cycle.phase);drift+=cycle.dailyDrift;assert.ok(cycle.from<=at&&at<cycle.to);assert.ok(cycle.to-cycle.from>=2*DAY);assert.ok(Math.abs(Object.values(cycle.signals).reduce((a,b)=>a+b,0))<1e-10);assert.ok(Object.values(cycle.signals).some(n=>n>0));assert.ok(Object.values(cycle.signals).some(n=>n<0));assert.deepEqual(marketCycle(at+300000,'cycle-test',stocks).signals,cycle.signals);}
 assert.equal(phases.size,3);assert.ok(drift/56>.0005&&drift/56<.003);
 const before=marketCycle(start,'cycle-test',stocks),changed=stocks.map(s=>s.id==='000001'?{...s,eps:s.eps*1.5}:s),after=marketCycle(start,'cycle-test',changed);assert.ok(after.signals['000001']>before.signals['000001']);
});
test('industrial events release every few days, expire and never appear before their release',()=>{
 const seen=new Map();for(let d=0;d<120;d++){const at=session(start+d*DAY).close,c=marketCycle(at,'event-calendar',stocks);for(const event of c.events){assert.ok(at>=event.start&&at<event.end);seen.set(event.id,event);}}
 const events=[...seen.values()].sort((a,b)=>a.start-b.start);assert.ok(events.length>=29);
 for(let i=1;i<events.length;i++){const gap=events[i].start-events[i-1].start;assert.ok(gap>=3*DAY-3600000&&gap<=5*DAY+3600000);}
 for(const event of events){const prior=marketCycle(event.start-300000,'event-calendar',stocks),after=marketCycle(event.end,'event-calendar',stocks);assert.ok(!prior?.events.some(e=>e.id===event.id));assert.ok(!after.events.some(e=>e.id===event.id));}
});
test('event effects differ by industry and revised conditions can reverse the remaining pressure',()=>{
 let chosen;for(let i=0;i<50&&!chosen;i++){const secret='revision-'+i;for(let day=0;day<15&&!chosen;day++){const at=session(start+day*DAY).close,cycle=marketCycle(at,secret,stocks),event=cycle.events.find(e=>e.revised&&e.reviewAt<e.end);if(event)chosen={secret,event};}}
 assert.ok(chosen);const {secret,event}=chosen,stock=equities.find(s=>(event.template.exposure[s.sector]||0)>.5)||equities.find(s=>(event.template.exposure[s.sector]||0)<-.5),early=event.start+300000,late=event.reviewAt;
 const contribution=at=>{const c=marketCycle(at,secret,stocks),none={...c,events:[]};return cycleMove(stock,c,at,85)-cycleMove(stock,none,at,85)};
 assert.ok(contribution(early)*contribution(late)<0);
 const context=marketCycle(early,secret,stocks),moves=equities.map(s=>cycleMove(s,context,early,85));assert.ok(Math.max(...moves)-Math.min(...moves)>.00001);
 const release=marketCycle(event.start,secret,stocks),articles=cycleArticles(release,event.start,[]);assert.ok(articles.some(a=>a.id===event.id));assert.equal(cycleArticles(marketCycle(event.start,secret,stocks),event.start,articles).length,0);
});
test('rollout adds causal news once, keeps existing prices and accounts, and exposes no future event payload',async()=>{
 const db=new LocalD1(),at=CYCLE_MODEL_START;await bootstrap(db,at-300000);db.sqlite.prepare("UPDATE market SET last_tick=?,seed='rollout-test'").run(at-300000);
 const before=db.sqlite.prepare("SELECT price,initial FROM stocks WHERE id='000001'").get();assert.equal(before.price,before.initial);
 await advanceMarket(db,at,4);assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM news WHERE category='시장동향'").get().n,1);const tickCount=db.sqlite.prepare('SELECT COUNT(*) AS n FROM ticks').get().n;
 await advanceMarket(db,at,4);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM ticks').get().n,tickCount);assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM news WHERE category='시장동향'").get().n,1);
 const data=await snapshot(db,null,'000001',at,false),article=data.news.find(n=>n.category==='시장동향');assert.ok(article);assert.ok(article.details.easy.impact);assert.ok(data.news.every(n=>n.ts<=at));assert.ok(!JSON.stringify(data).includes('rollout-test'));assert.ok(!JSON.stringify(data).includes('dailyDrift'));assert.ok(data.news.every(n=>!('impact'in n)&&!('financialUpdate'in n.details)));assert.equal(data.stocks.find(s=>s.id==='000001').initial,before.initial);
});
test('earnings and contract stories retain a smaller directional effect after the first hour',()=>{
 const at=start+DAY,article={id:'retained-news',ts:at-2*3600000,expires:at+DAY,stock_id:'000001',sector:null,impact:.02,category:'실적',details:'{}'};let difference=0;
 for(let i=0;i<1000;i++){const seed=createHash('sha256').update('news-tail-'+i).digest('hex'),base=calculateTick(stocks,[],[],at,undefined,undefined,seed),news=calculateTick(stocks,[],[article],at,undefined,undefined,seed);difference+=news[0].price-base[0].price;}
 assert.ok(difference>0);
});
