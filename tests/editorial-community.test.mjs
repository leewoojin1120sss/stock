import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalD1} from './db.mjs';
import {advanceMarket,accountFor,snapshot,seedStocks} from '../lib/engine.ts';
import {makeNews,NEWS_TYPES} from '../lib/news.ts';
import {publicArticle} from '../lib/editorial.ts';
import {ensureInformation,informationSnapshot,communityThread,commentOnPost,deleteComment,likePost,publishPost,deletePost,subscribe,researchArticle,buildResearch} from '../lib/information.ts';
const now=Date.parse('2026-10-20T15:00:00+09:00'),key=()=>crypto.randomUUID();
async function setup(){const db=new LocalD1();await advanceMarket(db,now);await accountFor(db,'alice',now);await accountFor(db,'bob',now);await ensureInformation(db,now);return db;}
test('all editorial categories include detailed reporting and easy explanations without exposing price-model payloads',()=>{
 for(let i=0;i<NEWS_TYPES.length;i++){
  const n=makeNews(now-i,seedStocks(),false,undefined,i,'editorial-test'),stored=JSON.parse(n.details),read=publicArticle({...n,impact:undefined});
  assert.equal(stored.paragraphs.length,5);assert.ok(stored.oneLine.length>20);assert.ok(stored.easy.terms.length>=1);assert.ok(stored.easy.impact.length>30);assert.ok(stored.easy.caveat.length>20);
  assert.equal('financialUpdate'in read.details,false);assert.equal('impact'in read,false);
 }
 const old=publicArticle({title:'기존 기사',category:'실적',body:'기존 원문',details:JSON.stringify({paragraphs:['보존할 원문'],financialUpdate:{eps:1}})});
 assert.deepEqual(old.details.paragraphs,['보존할 원문']);assert.ok(old.details.easy);assert.ok(old.details.oneLine);
});
test('comments and likes represent real members, hide account IDs and cannot be inflated by retries',async()=>{
 const db=await setup(),id=(await informationSnapshot(db,'alice',now)).posts[0].id;
 let thread=await communityThread(db,null,id);assert.deepEqual(thread.comments,[]);assert.equal(thread.likes,0);
 const request={id,body:'저는 아직 지켜볼게요.',requestKey:key()};await commentOnPost(db,'alice',request,now);await commentOnPost(db,'alice',request,now+1);
 await likePost(db,'bob',id,true,now);await likePost(db,'bob',id,true,now+1);
 thread=await communityThread(db,'alice',id);assert.equal(thread.comments.length,1);assert.equal(thread.likes,1);assert.equal(thread.comments[0].own,true);assert.equal('user_id'in thread,false);assert.equal('user_id'in thread.comments[0],false);
 await assert.rejects(deleteComment(db,'bob',thread.comments[0].id),/삭제할 수 없는/);
 await deleteComment(db,'alice',thread.comments[0].id);await likePost(db,'bob',id,false,now+2);thread=await communityThread(db,'bob',id);assert.equal(thread.comments.length,0);assert.equal(thread.likes,0);
 await assert.rejects(commentOnPost(db,'alice',{id,body:'x',requestKey:key()},now+2),/댓글은/);
 await assert.rejects(likePost(db,'alice','missing',true,now+2),/없습니다/);
});
test('post deletion cascades its discussion and likes without affecting other posts',async()=>{
 const db=await setup();await publishPost(db,'alice',{stockId:'000001',title:'계약 기사 읽어봤어요',body:'돈이 언제 들어오는지 확인하고 싶어요.'},now);
 const id=(await informationSnapshot(db,'alice',now)).posts.find(p=>p.own).id;
 await commentOnPost(db,'bob',{id,body:'저도 궁금해요.',requestKey:key()},now);await likePost(db,'bob',id,true,now);
 await assert.rejects(deletePost(db,'bob',id),/삭제할 수 없는/);await deletePost(db,'alice',id);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM community_comments').get().n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM community_likes').get().n,0);
 assert.ok((await informationSnapshot(db,null,now)).posts.length>0);
});
test('paid research has core numbers, sources, scenario limits and easy reading while metadata stays gated',async()=>{
 const db=await setup(),info=await informationSnapshot(db,'alice',now),id=info.reports[0].id;
 await assert.rejects(researchArticle(db,'bob',id,now),/구독/);await subscribe(db,'alice',key(),now);
 const {body}=await researchArticle(db,'alice',id,now);assert.ok(body.oneLine);assert.ok(body.easy.impact);assert.ok(body.evidenceNote);assert.equal(body.sections[0].title,'핵심 판단');
 assert.equal(info.reports.some(r=>'body'in r),false);
 const original=JSON.stringify(body.snapshot);db.sqlite.exec('UPDATE stocks SET price=price*2,eps=eps*2');assert.equal(JSON.stringify((await researchArticle(db,'alice',id,now+1)).body.snapshot),original);
 db.sqlite.prepare('UPDATE research_reports SET body=? WHERE id=?').run(JSON.stringify({...body,easy:undefined,oneLine:undefined}),id);
 const legacy=await researchArticle(db,'alice',id,now+2);assert.ok(legacy.body.easy);assert.equal(JSON.stringify(legacy.body.snapshot),original);
});
test('wording upgrade preserves player posts, passes, cash and previously published facts',async()=>{
 const db=await setup();await publishPost(db,'alice',{stockId:'000001',title:'내 의견은 유지해주세요',body:'이 회사는 조금 더 지켜보려고 해요.'},now);await subscribe(db,'alice',key(),now);
 const before=db.sqlite.prepare('SELECT cash FROM accounts WHERE id=?').get('alice').cash,news=db.sqlite.prepare('SELECT details FROM news ORDER BY ts DESC LIMIT 1').get().details;
 db.sqlite.exec('UPDATE market SET info_version=1');await ensureInformation(db,now);await ensureInformation(db,now);
 assert.equal(db.sqlite.prepare('SELECT cash FROM accounts WHERE id=?').get('alice').cash,before);assert.equal(db.sqlite.prepare('SELECT body FROM community_posts WHERE user_id=?').get('alice').body,'이 회사는 조금 더 지켜보려고 해요.');assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM research_purchases').get().n,1);assert.equal(db.sqlite.prepare('SELECT details FROM news ORDER BY ts DESC LIMIT 1').get().details,news);
});
