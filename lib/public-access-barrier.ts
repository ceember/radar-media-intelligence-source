import {load} from 'cheerio/slim';

export function publisherHasAccessBarrier(html: string): boolean {
  if (Buffer.byteLength(html) > 2_000_000) throw new Error('Source or selectors exceed the supported bounds.');
  const $ = load(html);
  let blocked = false;
  $('input').each((_index,node) => {
    if (($(node).attr('type') ?? '').trim().toLowerCase() === 'password') blocked = true;
  });
  $('[id],[class],[data-paywall],[data-captcha]').each((_index,node) => {
    const element = $(node);
    if (/paywall|captcha|(?:^|[\s_-])(?:challenge-form|cf-challenge|cf-chl|cf-turnstile|human-verification)(?:$|[\s_-])/i.test(`${element.attr('id') ?? ''} ${element.attr('class') ?? ''}`)
      || element.attr('data-paywall') !== undefined || element.attr('data-captcha') !== undefined) blocked = true;
  });
  $('form').each((_index,node) => {
    const form = $(node);
    let action = form.attr('action') ?? '';
    try { action = decodeURIComponent(action); } catch { blocked = true; }
    if (/(?:^|[\s/_?&#=-])(?:log[\s_-]?in|sign[\s_-]?in|authenticate)(?:$|[\s/_?&#=-])/i.test(
      `${form.attr('id') ?? ''} ${form.attr('class') ?? ''} ${action}`)) blocked = true;
    const concealed = [node,...form.parents().toArray()].some(parent => {
      const context = $(parent);
      return context.attr('hidden') !== undefined || (context.attr('aria-hidden') ?? '').trim().toLowerCase() === 'true';
    });
    if (!concealed) {
      const visible = form.clone();
      visible.find('script,style,noscript,template,[hidden],[aria-hidden="true"]').remove();
      if (/\bverify (?:that )?you are (?:a )?human\b/i.test(visible.text().replace(/\s+/g,' '))) blocked = true;
    }
    form.find('input[autocomplete]').each((_fieldIndex,field) => {
      if (/(?:^|\s)(?:username|current-password|new-password)(?:$|\s)/i.test($(field).attr('autocomplete') ?? '')) blocked = true;
    });
  });
  $('script[src]').each((_index,node) => {
    try {
      const script = new URL($(node).attr('src') ?? '', 'https://publisher.example');
      if (/\/cdn-cgi\/challenge-platform(?:\/|$)/i.test(decodeURIComponent(script.pathname))) blocked = true;
    } catch { return; }
  });
  const text = $.root().text().replace(/\s+/g,' ');
  return blocked || /"isAccessibleForFree"\s*:\s*false/i.test(html)
    || /subscribe to (?:read|continue)|sign in to (?:read|continue)/i.test(text);
}
