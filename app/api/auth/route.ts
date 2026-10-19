import {env} from 'cloudflare:workers';
import {register,authenticate,newSession,sessionUser,logout,changePassword,rateLimit,sameOrigin,AuthError} from '../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(data:unknown,status=200,cookie?:string)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})}});
export async function GET(request:Request){if(!env.DB)return reply({error:'잠시 후 다시 이용해주세요.'},503);return reply({user:await sessionUser(env.DB,request)});}
export async function POST(request:Request){
 try{if(!sameOrigin(request))return reply({error:'허용되지 않은 요청입니다.'},403);if(!env.DB)return reply({error:'잠시 후 다시 이용해주세요.'},503);const text=await request.text();if(text.length>2048)return reply({error:'입력한 내용이 너무 깁니다.'},413);let body;try{body=JSON.parse(text);}catch{return reply({error:'입력을 확인해주세요.'},400);}if(!body||typeof body!=='object')return reply({error:'입력을 확인해주세요.'},400);
  const now=Date.now();
  if(body.action==='logout')return reply({ok:true},200,await logout(env.DB,request));
  await rateLimit(env.DB,'ip:'+(request.headers.get('CF-Connecting-IP')||'unknown'),now,40);
  if(body.action==='register'){const user=await register(env.DB,body,now);return reply({user},201,await newSession(env.DB,user.userId,now));}
  if(body.action==='login'){const user=await authenticate(env.DB,body,now);return reply({user},200,await newSession(env.DB,user.userId,now));}
  if(body.action==='password'){const user=await sessionUser(env.DB,request,now);if(!user)return reply({error:'로그인 후 이용해주세요.'},401);await changePassword(env.DB,user.userId,body.currentPassword,body.password,now);return reply({ok:true},200,await newSession(env.DB,user.userId,now));}
  return reply({error:'요청을 확인해주세요.'},400);
 }catch(e){if(e instanceof AuthError)return reply({error:e.message},e.status);console.error('authentication failed');return reply({error:'요청을 처리하지 못했습니다. 잠시 후 다시 이용해주세요.'},503);}
}
