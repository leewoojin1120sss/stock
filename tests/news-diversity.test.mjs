import test from 'node:test';
import assert from 'node:assert/strict';
import {DAY,STEP,seedStocks,economicCalendar} from '../lib/market-data.ts';
import {makeNews,NEWS_TYPES} from '../lib/news.ts';
import {businessDesks} from '../lib/news-narrative.ts';
import {makeCommunityTip,ensureInformation,publishPost} from '../lib/information.ts';
import {bootstrap,accountFor} from '../lib/engine.ts';
import {publicArticle} from '../lib/editorial.ts';
import {LocalD1} from './db.mjs';
const now=Date.parse('2026-10-21T11:00:00+09:00'),stocks=seedStocks();

test('daily calendar avoids duplicate companies, covers the whole exchange and matches its released articles',()=>{
 const covered=new Set();
 for(let day=0;day<30;day++){
  const calendar=economicCalendar(now+day*DAY,stocks),companies=calendar.filter(e=>e.stock_id);
  assert.equal(companies.length,5);assert.equal(new Set(companies.map(e=>e.stock_id)).size,5);
  for(const event of calendar){
   assert.ok(event.organization);assert.equal(event.completed,event.ts<=now+day*DAY);
   const article=makeNews(event.ts,stocks,false,undefined,undefined,'schedule-fixture');
   assert.equal(article.category,NEWS_TYPES[event.newsType]);
   assert.equal(article.stock_id,event.stock_id);if(day<6&&event.stock_id)covered.add(event.stock_id);
  }
 }
 assert.equal(covered.size,26);
});

test('one news category contains genuinely different business stories, not only changed figures',()=>{
 assert.equal(Object.keys(businessDesks).length,26);assert.equal(Object.values(businessDesks).reduce((n,d)=>n+d.beats.length,0),78);
 const covered=new Set(),stories=new Set(),reporting=new Set();
 for(let i=0;i<420;i++){
  const article=makeNews(now+i*STEP,stocks,false,undefined,4,'editorial-diversity-'+i),d=JSON.parse(article.details);
  covered.add(article.stock_id);stories.add(d.storyKey);reporting.add(d.paragraphs[1]);
  assert.equal(article.category,'제품·서비스');assert.equal(d.paragraphs.length,5);
  assert.ok(d.paragraphs.join('').includes('밝혔다')||d.paragraphs.join('').includes('설명했다'));
  assert.ok(d.paragraphs[2].includes(stocks.find(s=>s.id===article.stock_id).name));
  assert.ok(!/PER|BPS|EPS|PBR/.test(article.title));assert.ok(d.oneLine);
  assert.ok(!/환율\([^)]|금리\([^)]/.test(JSON.stringify(publicArticle(article))));
 }
 assert.equal(covered.size,26);assert.ok(stories.size>=70);assert.ok(reporting.size>=70);
});

test('community rumors are casual, varied and consistently separated from verified news',()=>{
 for(const stock of stocks.filter(s=>s.kind==='stock')){
  const bodies=new Set();
  for(let i=0;i<30;i++){
   const post=makeCommunityTip(stock,now+i*60000,'rumor-fixture',i);bodies.add(post.body);
   assert.equal(post.source,'unverified');assert.equal(post.user_id,null);assert.ok(post.author.includes('봇'));
   assert.ok(!/(습니다|입니다|하세요|인가요|해요|예요)/.test(post.body));
   assert.equal('impact'in post,false);assert.equal('likes'in post,false);assert.equal('comments'in post,false);
  }
  assert.equal(bodies.size,3,stock.name);
 }
});

test('rollout immediately publishes new writing once without rewriting archived facts or player posts',async()=>{
 const db=new LocalD1();await bootstrap(db,now);await accountFor(db,'alice',now);
 await publishPost(db,'alice',{stockId:'000001',title:'내 글은 그대로 남겨줘',body:'직접 남긴 의견과 투자 기록은 바뀌면 안 돼.'},now);
 const original=db.sqlite.prepare('SELECT id,details,impact FROM news ORDER BY ts DESC LIMIT 1').get();
 const cash=db.sqlite.prepare("SELECT cash FROM accounts WHERE id='alice'").get().cash;
 await ensureInformation(db,now);await ensureInformation(db,now+1000);
 const launched=db.sqlite.prepare("SELECT * FROM news WHERE id LIKE 'editorial-v3-launch-%'").all();
 assert.equal(launched.length,18);assert.ok(launched.every(n=>n.ts===now&&n.impact===0&&!JSON.parse(n.details).financialUpdate));
 assert.deepEqual({...db.sqlite.prepare('SELECT id,details,impact FROM news WHERE id=?').get(original.id)},{...original});
 assert.equal(db.sqlite.prepare("SELECT cash FROM accounts WHERE id='alice'").get().cash,cash);
 assert.equal(db.sqlite.prepare("SELECT body FROM community_posts WHERE user_id='alice'").get().body,'직접 남긴 의견과 투자 기록은 바뀌면 안 돼.');
 assert.equal(db.sqlite.prepare('SELECT info_version FROM market').get().info_version,3);
});
