import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalD1} from './db.mjs';
import {bootstrap,snapshot} from '../lib/engine.ts';
import {DAY} from '../lib/market-data.ts';

test('index chart receives month-long actual tick history beyond the short dashboard sparkline',async()=>{
 const db=new LocalD1(),now=Date.parse('2026-10-21T17:00:00+09:00');await bootstrap(db,now-35*DAY);
 db.sqlite.prepare('INSERT INTO ticks(ts,index_value,rate,fx,oil,gold) VALUES(?,900,3,1340,78,2700)').run(now-31*DAY);
 db.sqlite.prepare('INSERT INTO ticks(ts,index_value,rate,fx,oil,gold) VALUES(?,950,3,1340,78,2700)').run(now-29*DAY);
 for(let i=0;i<105;i++)db.sqlite.prepare('INSERT INTO ticks(ts,index_value,rate,fx,oil,gold) VALUES(?,?,3,1340,78,2700)').run(now-(104-i)*300000,1000+i);
 const data=await snapshot(db,null,'000001',now,false);
 assert.equal(data.index.length,100);assert.equal(data.macroHistory.length,106);
 assert.equal(data.macroHistory[0].index_value,950);assert.equal(data.macroHistory.at(-1).index_value,1104);
 assert.ok(data.macroHistory.every((r,i,a)=>Number.isFinite(r.index_value)&&r.ts>=now-30*DAY&&(!i||r.ts>a[i-1].ts)));
 const other=await snapshot(db,null,'000103',now,false);assert.deepEqual(other.macroHistory,data.macroHistory);
});
