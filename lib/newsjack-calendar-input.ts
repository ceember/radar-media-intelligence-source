export function calendarInputLines(value:string){
 return value.split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{
  const [dateField,title,url,...quote]=line.split('|').map(part=>part.trim());
  const dates=/^(\d{4}-\d{2}-\d{2})(?:\s*\.\.\s*(\d{4}-\d{2}-\d{2}))?$/.exec(dateField);
  return {date:dates?.[1]??dateField,...(dates?.[2]?{endDate:dates[2]}:{}),title,url,quote:quote.join('|').trim()};
 });
}
