const crypto = require('node:crypto');
const MAX_FILE = 2 * 1024 * 1024;
const canonical = 'https://xn--72czq3aheb5c3fza5gva.online';
function clean(v,max=200){return typeof v==='string'?v.trim().slice(0,max):'';}
function validate(body){
 if(!body||!['quote','worksheet','support','sponsor'].includes(body.type)||body.consent!==true||body.website)throw Error('กรุณาตรวจข้อมูลและรับทราบการใช้ข้อมูล');
 const r={type:body.type,requestId:clean(body.requestId,80),name:clean(body.name),school:clean(body.school),role:clean(body.role),phone:clean(body.phone,30),email:clean(body.email,254),province:clean(body.province),grade:clean(body.grade),subject:clean(body.subject),worksheet:clean(body.worksheet,600),quantity:clean(String(body.quantity||''),20),details:clean(body.details,12000),source:clean(body.source,600),consent:true,marketing:body.marketing===true};
 if(r.type==='worksheet'&&['ผู้ปกครอง','บุคคลทั่วไป'].includes(r.role)&&!r.school)r.school='ไม่ระบุโรงเรียน / องค์กร';
 if(!/^[a-zA-Z0-9_-]{16,80}$/.test(r.requestId)||!r.name||!r.school||!/^\S+@\S+\.\S+$/.test(r.email)||/[\r\n]/.test(r.email))throw Error('กรุณาระบุชื่อ โรงเรียน และอีเมลที่ถูกต้อง');
 if((['quote','support','sponsor'].includes(r.type)||r.phone)&&!/^\+?[\d\s()-]{8,25}$/.test(r.phone))throw Error('กรุณาระบุเบอร์โทรติดต่อกลับให้ถูกต้อง');
 if(body.attachment){const a=body.attachment,bytes=typeof a.base64==='string'?Buffer.from(a.base64,'base64'):Buffer.alloc(0);if(!bytes.length||bytes.length>MAX_FILE||!/^[A-Za-z0-9+/]*={0,2}$/.test(a.base64))throw Error('ไฟล์ต้องมีขนาดไม่เกิน 2 MB');const type=String(a.type||'');const pdf=bytes.subarray(0,5).toString()==='%PDF-',png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;if(!(type==='application/pdf'&&pdf||type==='image/png'&&png||type==='image/jpeg'&&jpg))throw Error('รองรับเฉพาะ PDF, JPG และ PNG');r.attachment={name:clean(a.name,150).replace(/[\r\n/\\]/g,'_')||'attachment',type,base64:a.base64};}
 return r;
}
function ready(){return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(process.env.LEADS_APPS_SCRIPT_URL||'')&&(process.env.LEADS_SHARED_SECRET||'').length>=32;}
module.exports = async (req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');const reply=(code,obj)=>res.status(code).json(obj);
 if(req.method==='GET')return reply(200,{ready:ready()});
 if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return reply(405,{ok:false,message:'ไม่รองรับคำขอนี้'});}
 const origin=req.headers.origin||'',allowed=new Set([canonical,'https://www.xn--72czq3aheb5c3fza5gva.online']);if(process.env.VERCEL_URL)allowed.add('https://'+process.env.VERCEL_URL);if(!process.env.VERCEL&&/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))allowed.add(origin);if(!allowed.has(origin))return reply(403,{ok:false,message:'กรุณาส่งผ่านหน้าเว็บไซต์'});
 if(!ready())return reply(503,{ok:false,message:'ระบบรับคำขอออนไลน์กำลังเชื่อมต่อ กรุณาโทร 095-720-8058 หรือแชต LINE'});
 if(!String(req.headers['content-type']||'').startsWith('application/json'))return reply(415,{ok:false,message:'รูปแบบข้อมูลไม่ถูกต้อง'});
 let lead;try{const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(Buffer.byteLength(raw||'')>3100000)throw Error('ข้อมูลหรือไฟล์มีขนาดใหญ่เกินไป');lead=validate(typeof req.body==='string'?JSON.parse(req.body):req.body);}catch(err){return reply(400,{ok:false,message:err.message||'กรุณาตรวจข้อมูลอีกครั้ง'});}
 const client=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();const secret=process.env.LEADS_SHARED_SECRET,clientHash=crypto.createHmac('sha256',secret).update(client).digest('hex');const payloadHash=crypto.createHash('sha256').update(JSON.stringify(lead)).digest('hex');
 try{const upstream=await fetch(process.env.LEADS_APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret,lead,clientHash,payloadHash}),signal:AbortSignal.timeout(25000)});if(!upstream.ok)throw Error('upstream_http');const data=await upstream.json();if(data.error==='rate_limit')return reply(429,{ok:false,message:'ส่งคำขอหลายครั้งแล้ว กรุณารอสักครู่หรือติดต่อทางโทรศัพท์'});if(data.error==='request_conflict')return reply(409,{ok:false,message:'ข้อมูลคำขอเปลี่ยนไป กรุณาเริ่มส่งคำขอใหม่'});if(!data.ok||!/^LEAD-\d{8}-[A-Z0-9]{8}$/.test(data.id||''))throw Error('upstream_rejected');if(data.notified===false)console.error('lead_notification_pending',data.id);return reply(200,{ok:true,id:data.id});}catch(err){console.error('lead_submit_failed',err.name||'Error');return reply(502,{ok:false,message:'ยังยืนยันการส่งไม่ได้ กรุณาลองอีกครั้ง ข้อมูลที่กรอกยังอยู่ หรือโทร 095-720-8058'});}
};
module.exports.validate=validate;
