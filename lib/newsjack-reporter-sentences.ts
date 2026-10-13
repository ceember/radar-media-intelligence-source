import type {NewsjackSource} from './newsjack-types';

const segmenter=new Intl.Segmenter('en',{granularity:'sentence'});
export type ReporterSentence={id:number;text:string;start:number;end:number};
export function reporterBodySentences(source:NewsjackSource):ReporterSentence[]{
 if(!source.read||source.text.length>20000)return [];
 const sentences:ReporterSentence[]=[];
 for(const part of segmenter.segment(source.text)){
  if(!part.segment.trim())continue;
  const start=part.index+part.segment.search(/\S/u),end=part.index+part.segment.trimEnd().length;
  sentences.push({id:sentences.length+1,text:source.text.slice(start,end),start,end});
  if(sentences.length===200)break;
 }
 return sentences;
}
export function reporterSentenceQuote(source:NewsjackSource,ids:number[]):string|null{
 if(!ids.length)return '';
 if(ids.length>3||ids.some((id,index)=>!Number.isInteger(id)||id<1||(index>0&&id!==ids[index-1]+1)))return null;
 const sentences=reporterBodySentences(source),first=sentences.find(sentence=>sentence.id===ids[0]),last=sentences.find(sentence=>sentence.id===ids[ids.length-1]);
 if(!first||!last)return null;
 const quote=source.text.slice(first.start,last.end);
 if(source.text.indexOf(quote)!==first.start||source.text.lastIndexOf(quote)!==first.start)return null;
 return quote.length<=1200?quote:null;
}
