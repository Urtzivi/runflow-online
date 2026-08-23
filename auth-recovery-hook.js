'use strict';
const http = require('http');
const { URL } = require('url');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '');
const APP_BASE_URL = String(process.env.APP_BASE_URL || '').replace(/\/$/, '');
const originalCreateServer = http.createServer;

function sendJson(res,status,data){
  const body=JSON.stringify(data);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'});
  res.end(body);
}
function readJson(req,max=100000){return new Promise((resolve,reject)=>{let body='';req.on('data',c=>{body+=c;if(body.length>max){reject(new Error('Solicitud demasiado grande.'));req.destroy();}});req.on('end',()=>{try{resolve(body?JSON.parse(body):{})}catch{reject(new Error('JSON no válido.'))}});req.on('error',reject);});}

http.createServer=function patchedCreateServer(...args){
  const listener=typeof args[0]==='function'?args[0]:args[1];
  const options=typeof args[0]==='function'?undefined:args[0];
  const wrapped=async(req,res)=>{
    try{
      const url=new URL(req.url,'http://runflow.local');
      if(req.method==='POST'&&url.pathname==='/api/auth/recover'){
        const {email}=await readJson(req);
        const normalized=String(email||'').trim().toLowerCase();
        if(!normalized||!normalized.includes('@'))return sendJson(res,400,{error:'Introduce un correo electrónico válido.'});
        if(!SUPABASE_URL||!SUPABASE_ANON_KEY)return sendJson(res,503,{error:'La recuperación de contraseña no está disponible en este momento.'});
        const redirect=`${APP_BASE_URL}/activate.html`;
        const endpoint=`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirect)}`;
        const response=await fetch(endpoint,{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${SUPABASE_ANON_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({email:normalized})});
        const data=await response.json().catch(()=>({}));
        if(!response.ok){const msg=data?.msg||data?.message||data?.error_description||data?.error||'No se pudo enviar el correo de recuperación.';return sendJson(res,response.status,{error:msg});}
        return sendJson(res,200,{ok:true,message:'Si existe una cuenta con ese correo, recibirás un enlace para definir una nueva contraseña.'});
      }
      return listener(req,res);
    }catch(error){if(!res.headersSent)return sendJson(res,500,{error:error.message||'Error de recuperación.'});try{res.end();}catch{}}
  };
  return options===undefined?originalCreateServer.call(http,wrapped):originalCreateServer.call(http,options,wrapped);
};
