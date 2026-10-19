import {scrypt,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
export const COOKIE='__Host-bs_session';
const TTL=7*86400000;
export class AuthError extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status;}}
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const derive=(password:string,salt:string)=>new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,{N:16384,r:8,p:5,maxmem:32*1024*1024},(err,key)=>err?reject(err):resolve(key)));
export async function hashPassword(password:string){const salt=randomBytes(16).toString('hex');return 'scrypt$16384$8$5$'+salt+'$'+(await derive(password,salt)).toString('hex');}
export async function verifyPassword(password:string,encoded:string){const parts=encoded.split('$');if(parts.length!==6||parts[0]!=='scrypt'||parts[1]!=='16384'||parts[2]!=='8'||parts[3]!=='5')return false;const actual=await derive(password,parts[4]),expected=Buffer.from(parts[5],'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
export function cleanNickname(value:unknown){if(typeof value!=='string'||!/^[가-힣a-zA-Z0-9 _-]{2,16}$/.test(value.trim().normalize('NFC')))throw new AuthError('닉네임은 한글·영문·숫자로 2~16자 입력해주세요.');return value.trim().normalize('NFC');}
export function cleanLogin(value:unknown){if(typeof value!=='string'||!/^[a-zA-Z0-9_]{4,24}$/.test(value))throw new AuthError('아이디는 영문·숫자·밑줄로 4~24자 입력해주세요.');return value.toLowerCase();}
function passwordInput(value:unknown){if(typeof value!=='string'||value.length<8||value.length>128)throw new AuthError('비밀번호는 8~128자로 입력해주세요.');return value;}
export async function rateLimit(db:D1Database,key:string,now:number,limit=8){
 const k=digest(key);await db.prepare('INSERT INTO auth_attempts(key,window,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window<=?-60000 THEN 1 ELSE attempts+1 END,window=CASE WHEN window<=?-60000 THEN ? ELSE window END').bind(k,now,now,now,now).run();
 const row=await db.prepare('SELECT attempts FROM auth_attempts WHERE key=?').bind(k).first<{attempts:number}>();if((row?.attempts||0)>limit)throw new AuthError('시도 횟수가 많습니다. 1분 뒤 다시 이용해주세요.',429);
}
export function rawToken(request:Request){const found=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));const token=found?.slice(COOKIE.length+1)||'';return /^[a-f0-9]{64}$/.test(token)?token:null;}
export async function sessionUser(db:D1Database,request:Request,now=Date.now()){
 const token=rawToken(request);if(!token)return null;
 return db.prepare('SELECT c.user_id AS userId,c.login,a.nickname FROM sessions s JOIN credentials c ON c.user_id=s.user_id JOIN accounts a ON a.id=c.user_id WHERE s.token_hash=? AND s.expires>?').bind(digest(token),now).first<{userId:string;login:string;nickname:string}>();
}
export async function newSession(db:D1Database,userId:string,now:number){const token=randomBytes(32).toString('hex');await db.batch([db.prepare('DELETE FROM sessions WHERE expires<=?').bind(now),db.prepare('DELETE FROM auth_attempts WHERE window<?').bind(now-86400000),db.prepare('INSERT INTO sessions(token_hash,user_id,created,expires) VALUES(?,?,?,?)').bind(digest(token),userId,now,now+TTL)]);return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL/1000}`;}
export async function register(db:D1Database,input:Record<string,unknown>,now:number){
 const login=cleanLogin(input.login),password=passwordInput(input.password),nickname=cleanNickname(input.nickname),userId='bs_'+crypto.randomUUID(),passwordHash=await hashPassword(password);
 try{await db.batch([db.prepare('INSERT INTO accounts(id,nickname,cash,reserved,realized,created) VALUES(?,?,10000000,0,0,?)').bind(userId,nickname,now),db.prepare('INSERT INTO credentials(user_id,login,password_hash,created) VALUES(?,?,?,?)').bind(userId,login,passwordHash,now)]);}catch(e){if(String(e).includes('UNIQUE'))throw new AuthError('이미 사용 중인 아이디입니다.');throw e;}
 return {userId,login,nickname};
}
export async function authenticate(db:D1Database,input:Record<string,unknown>,now:number){
 const login=cleanLogin(input.login),password=passwordInput(input.password);await rateLimit(db,'login:'+login,now,8);
 const user=await db.prepare('SELECT user_id AS userId,login,password_hash AS passwordHash FROM credentials WHERE login=?').bind(login).first<{userId:string;login:string;passwordHash:string}>();
 // The dummy derivation keeps a missing account from becoming a cheap timing oracle.
 const encoded=user?.passwordHash||'scrypt$16384$8$5$00000000000000000000000000000000$'+'0'.repeat(128);
 const valid=await verifyPassword(password,encoded);if(!user||!valid)throw new AuthError('아이디 또는 비밀번호를 확인해주세요.',401);return {userId:user.userId,login:user.login};
}
export async function logout(db:D1Database,request:Request){const token=rawToken(request);if(token)await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(digest(token)).run();return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;}
export async function changePassword(db:D1Database,userId:string,current:unknown,next:unknown,now:number){const old=passwordInput(current),password=passwordInput(next);await rateLimit(db,'password:'+userId,now,5);const row=await db.prepare('SELECT password_hash FROM credentials WHERE user_id=?').bind(userId).first<{password_hash:string}>();if(!row||!await verifyPassword(old,row.password_hash))throw new AuthError('현재 비밀번호를 확인해주세요.',401);const hash=await hashPassword(password);await db.batch([db.prepare('UPDATE credentials SET password_hash=? WHERE user_id=?').bind(hash,userId),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(userId)]);}
export function sameOrigin(request:Request){return request.headers.get('Origin')===new URL(request.url).origin&&request.headers.get('Content-Type')?.startsWith('application/json')===true;}
