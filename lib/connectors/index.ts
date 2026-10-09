import type { Connector } from './types';
import { googleNews } from './googlenews';
import { gdelt } from './gdelt';
import { reddit } from './reddit';
import { bluesky } from './bluesky';
import { mastodon } from './mastodon';
import { hackerNews } from './hackernews';
import { youtube } from './youtube';
import { xTwitter } from './x';
import { telegram } from './telegram';
import { rss } from './rss';
import { instagram } from './instagram';
import { facebook } from './facebook';
import { tiktok } from './tiktok';
import { linkedin } from './linkedin';
import { linkedinWeb } from './linkedin-web';
import { newsapi } from './newsapi';
import { stackExchange } from './stackexchange';
import { github } from './github';
import { discord } from './discord';
import { secEdgar } from './sec-edgar';
import { arxiv } from './arxiv';
import { talkwalker } from './talkwalker';
import { lemmy } from './lemmy';
import { newsdata } from './newsdata';
import { podcastIndex } from './podcastindex';

export const CONNECTORS: Connector[] = [
  // Gratuite (alcune richiedono una chiave gratuita: reddit, youtube, discord)
  googleNews, gdelt, reddit, bluesky, mastodon, hackerNews, youtube, telegram, rss, linkedinWeb, stackExchange, github, discord, secEdgar, arxiv,
  lemmy, newsdata, podcastIndex,
  // Premium (si attivano con le chiavi API a pagamento)
  xTwitter, instagram, facebook, tiktok, linkedin, newsapi, talkwalker,
];

/**
 * Articolo di testata o post social?
 *
 * È la distinzione che separa una rassegna stampa dall'ascolto sociale: hanno
 * ritmi, autori e peso diversi, e vanno lette separate. Gli "upload" sono
 * ritagli stampa importati da file, quindi articoli.
 */
export type MentionKind = 'article' | 'post';
export const SOURCE_KIND: Record<string, MentionKind> = {
  googlenews: 'article', gdelt: 'article', newsapi: 'article', rss: 'article', upload: 'article', 'sec-edgar': 'article',
  reddit: 'post', bluesky: 'post', mastodon: 'post', hackernews: 'post', youtube: 'post',
  x: 'post', telegram: 'post', instagram: 'post', facebook: 'post', tiktok: 'post',
  linkedin: 'post', linkedin_web: 'post', stackexchange: 'post', github: 'post', discord: 'post',
  arxiv: 'article', talkwalker_news: 'article', talkwalker: 'post',
  lemmy: 'post', newsdata: 'article',
  // Un episodio è prodotto da una redazione, come un articolo: si legge con la
  // rassegna, non con i post.
  podcastindex: 'article',
};
/** Fonte sconosciuta: si presume post, la classe più prudente per il valore media. */
export const kindOf = (source: string): MentionKind => SOURCE_KIND[source] ?? 'post';

/**
 * Categoria tematica di una fonte — non ha effetto sui dati, serve solo a
 * organizzare la pagina Fonti: con 22 connettori un unico elenco piatto per
 * livello (gratis/gratis con chiave/a pagamento) è illeggibile.
 */
export type SourceCategory = 'general' | 'tech' | 'social' | 'video' | 'audio' | 'finance' | 'academic';
export const SOURCE_CATEGORY: Record<string, SourceCategory> = {
  googlenews: 'general', gdelt: 'general', newsapi: 'general', rss: 'general',
  hackernews: 'tech', stackexchange: 'tech', github: 'tech',
  reddit: 'social', bluesky: 'social', mastodon: 'social', x: 'social',
  instagram: 'social', facebook: 'social', tiktok: 'social', telegram: 'social',
  discord: 'social', linkedin: 'social', linkedin_web: 'social',
  youtube: 'video',
  'sec-edgar': 'finance',
  arxiv: 'academic', talkwalker: 'social', talkwalker_news: 'general',
  lemmy: 'social', newsdata: 'general', podcastindex: 'audio',
};
export const CATEGORY_ORDER: SourceCategory[] = ['general', 'finance', 'academic', 'tech', 'social', 'video', 'audio'];
export const CATEGORY_LABEL: Record<SourceCategory, string> = {
  general: 'General & news', finance: 'Financial & corporate', academic: 'Academic',
  tech: 'Tech & developer', social: 'Social & messaging', video: 'Video', audio: 'Podcasts & audio',
};

/**
 * Fonti valutate a CPM giornalistico nel valore media. Derivate dalla mappa qui
 * sopra per non avere due classificazioni divergenti — con l'eccezione degli
 * upload, la cui provenienza è ignota: contarli come stampa gonfierebbe il
 * valore di file che potrebbero contenere qualsiasi cosa.
 */
export const NEWS_SOURCES = Object.entries(SOURCE_KIND)
  .filter(([id, k]) => k === 'article' && id !== 'upload')
  .map(([id]) => id);

export { SOURCE_META } from '../source-meta';
