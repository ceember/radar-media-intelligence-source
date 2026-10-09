import { load } from 'cheerio/slim';
import { fetchPublicText } from './public-http';
import { extractArticleHtml } from './article-extract';
import { researchPublicUrl, researchTavilyKey, searchResearchWeb } from './tavily-research';
import { cleanStoredText } from './text-clean';
import { restrictedReading } from './article-reader-fallback';
import type { NewsjackStory, NewsjackSource } from './newsjack-types';

/** Only explicit publisher timestamps with a time zone; modification dates never restart the clock. */
export function publicationTimestamp(html:string):string|null {
  const $=load(html), dates:string[]=[];
  const meta=$('meta[property="article:published_time"]').attr('content'); if(meta) dates.push(meta);
  function collect(value:unknown) {
    if(Array.isArray(value)) value.forEach(collect);
    else if(value&&typeof value==='object') {
      const data=value as Record<string,unknown>;
      if(typeof data.datePublished==='string') dates.push(data.datePublished);
      if(data['@graph']) collect(data['@graph']);
    }
  }
  $('script[type="application/ld+json"]').each((_,node)=>{try{collect(JSON.parse($(node).text()))}catch{/* malformed publisher metadata */}});
  const valid=dates.filter(d=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(d)&&Number.isFinite(Date.parse(d)));
  return valid.length ? new Date(Math.min(...valid.map(Date.parse))).toISOString() : null;
}
/** A site's contact-form script is not a reading challenge; actual barriers stay blocked. */
export function restrictedNewsjackSource(html:string):boolean {
  const $=load(html);
  $('script:not([type="application/ld+json"])').remove();
  return restrictedReading($.html());
}
export async function readNewsjackSource(url:string,id:number,storyId?:number):Promise<NewsjackSource> {
  const checkedAt=new Date().toISOString();
  const base={id,url,title:url,text:'',publishedAt:null,checkedAt,read:false,...(storyId?{storyId}:{})};
  if(!researchPublicUrl(url)) return {...base,url:null};
  try {
    const page=await fetchPublicText(url,{timeoutMs:6000,maxBytes:1_000_000,maxRedirects:1});
    if(!/text\/html|application\/xhtml/i.test(page.contentType)||restrictedNewsjackSource(page.text)) return base;
    const article=extractArticleHtml(page.text,page.finalUrl); if(!article) return base;
    return {...base,url:researchPublicUrl(page.finalUrl),title:article.metadata.title??url,text:cleanStoredText(article.text,5000),
      publishedAt:publicationTimestamp(page.text),byline:article.metadata.byline??null,publisher:cleanStoredText(load(page.text)('meta[property="og:site_name"]').attr('content')??'',150)||null,read:true};
  } catch {return base;}
}
export async function newsjackOriginSources(stories:NewsjackStory[]) {
  const key=await researchTavilyKey();
  const sources:NewsjackSource[]=[], searchedIds:number[]=[];
  for(const story of stories) {
    sources.push(await readNewsjackSource(story.url,sources.length+1,story.id));
    if(!key) continue;
    try {
      const results=await searchResearchWeb(cleanStoredText(story.title,200),key,5000);
      searchedIds.push(story.id);
      const alternative=results.find(s=>s.url!==story.url&&new URL(s.url).hostname!==new URL(story.url).hostname);
      if(alternative) sources.push(await readNewsjackSource(alternative.url,sources.length+1,story.id));
    } catch {/* Unconfirmed origin stays Watch; failed search is not corroboration. */}
  }
  return {sources,searchedIds};
}
