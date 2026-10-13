import {fetchPublicRenderGateway,validatePublicUrl} from './public-http';
import {toolsGateway} from './mi-tools-gateway';
import {cleanStoredText} from './text-clean';
import {selectedPublicUrl} from './competitor-page';
import {withinResearchDeadline} from './web-research';

export const RENDER_UNAVAILABLE_MESSAGE='Rendered BODY refused or unavailable within its budget; result unknown. No automatic retry.';
export const RENDER_ACCESS_REFUSED_MESSAGE='Rendered BODY was access-refused; result unknown. No content saved or automatic retry.';

export function competitorRenderGateway(){
 return process.env.MI_TOOLS_RENDER_ENABLED==='1'?toolsGateway('render-page'):null;
}

export function parseRenderedBody(value:unknown,bearerToken:string):string{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!Object.hasOwn(value,'markdown'))throw Error('Rendered body unavailable.');
 const body=(value as {markdown:unknown}).markdown;
 if(typeof body!=='string'||body.length>100_000||!body.trim()||body.includes(bearerToken)||cleanStoredText(body).includes(cleanStoredText(bearerToken)))throw Error('Rendered body unavailable.');
 return cleanStoredText(body);
}

export async function renderCompetitorBody(input:string,deadline:number,fetchPage=fetchPublicRenderGateway,validate=validatePublicUrl){
 const gateway=competitorRenderGateway();
 if(!gateway)throw Error('Rendered body unavailable.');
 const url=selectedPublicUrl(input),wait=<T>(operation:PromiseLike<T>)=>withinResearchDeadline(operation,deadline);
 try{
  await wait(validate(url));await wait(validate(gateway.endpoint));
  const remaining=Math.floor(deadline-Date.now()-3000);
  if(remaining<1)throw Error('Rendered body unavailable.');
  const response=await wait(fetchPage(gateway.endpoint,{allowedHostname:gateway.hostname,timeoutMs:Math.min(40_000,remaining),maxBytes:700_000,
   body:JSON.stringify({url}),headers:{Authorization:`Bearer ${gateway.token}`,'Content-Type':'application/json',Accept:'application/json','Accept-Encoding':'identity'}}));
  if(Date.now()>=deadline)throw Error(RENDER_UNAVAILABLE_MESSAGE);
  if(!/^application\/json\b/i.test(response.contentType)||Buffer.byteLength(response.text)>700_000||response.text.includes(gateway.token))throw Error('Rendered body unavailable.');
  const body=parseRenderedBody(JSON.parse(response.text),gateway.token);
  if(Date.now()>=deadline)throw Error(RENDER_UNAVAILABLE_MESSAGE);
  return body;
 }catch(error){throw Error(Date.now()<deadline&&error instanceof Error&&error.message==='Public HTTP status 403'?RENDER_ACCESS_REFUSED_MESSAGE:RENDER_UNAVAILABLE_MESSAGE);}
}
