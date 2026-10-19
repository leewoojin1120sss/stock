import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { advanceMarket, snapshot, accountFor, placeOrder, cancelOrder } from '../../../lib/engine';
export const dynamic='force-dynamic';
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie'}});
export async function GET(request:Request){
 try{
  if(!env.DB)return response({error:'시장 서버를 준비 중입니다.'},503);
  const now=Date.now(),syncing=await advanceMarket(env.DB,now);
  const user=await getChatGPTUser();
  const selected=new URL(request.url).searchParams.get('stock')||'000001';
  return response(await snapshot(env.DB,user?.userId??null,/^\d{6}$/.test(selected)?selected:'000001',now,syncing));
 }catch(e){console.error('market read',e);return response({error:'시장을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'},503);}
}
export async function POST(request:Request){
 try{
  if(request.headers.get('Origin')!==new URL(request.url).origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return response({error:'허용되지 않은 요청입니다.'},403);
  const user=await getChatGPTUser();if(!user)return response({error:'로그인 후 이용해주세요.'},401);
  if(!env.DB)return response({error:'시장 서버를 준비 중입니다.'},503);
  const text=await request.text();if(text.length>2048)return response({error:'요청이 너무 큽니다.'},413);
  let input;try{input=JSON.parse(text);}catch{return response({error:'입력을 확인해주세요.'},400);}
  if(!input||typeof input!=='object')return response({error:'입력을 확인해주세요.'},400);
  const now=Date.now();if(await advanceMarket(env.DB,now))return response({error:'이전 시세를 정산 중입니다. 잠시 후 다시 주문해주세요.'},409);
  await accountFor(env.DB,user.userId,now);
  if(input.action==='order')return response(await placeOrder(env.DB,user.userId,input,Date.now()));
  if(input.action==='cancel')return response(await cancelOrder(env.DB,user.userId,input.id));
  if(input.action==='nickname'){
   if(typeof input.nickname!=='string'||!/^[가-힣a-zA-Z0-9 _-]{2,16}$/.test(input.nickname.trim()))return response({error:'닉네임은 한글·영문·숫자로 2~16자 입력해주세요.'},400);
   await env.DB.prepare('UPDATE accounts SET nickname=? WHERE id=?').bind(input.nickname.trim(),user.userId).run();return response({ok:true});
  }
  if(input.action==='watch'){
   if(typeof input.stockId!=='string'||!await env.DB.prepare('SELECT id FROM stocks WHERE id=?').bind(input.stockId).first())return response({error:'종목을 확인해주세요.'},400);
   if(input.enabled===true)await env.DB.prepare('INSERT OR IGNORE INTO watchlist(user_id,stock_id) VALUES(?,?)').bind(user.userId,input.stockId).run();
   else await env.DB.prepare('DELETE FROM watchlist WHERE user_id=? AND stock_id=?').bind(user.userId,input.stockId).run();return response({ok:true});
  }
  return response({error:'요청을 확인해주세요.'},400);
 }catch(e){const message=e instanceof Error?e.message:'';if(message&&!/D1_|SQLITE|constraint|binding|database/i.test(message))return response({error:message},400);console.error('market write',e);return response({error:'요청을 처리하지 못했습니다. 다시 확인해주세요.'},503);}
}
