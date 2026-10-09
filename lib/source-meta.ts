export const SOURCE_META: Record<string, { label: string; color: string; note?: string }> = {
  googlenews: { label: 'Google News', color: '#f59e0b' },
  talkwalker: {
    label: 'Talkwalker', color: '#00b8a9',
    note: 'Mentions pulled live from the corporate Talkwalker (Lumen by Hootsuite) account via its API, inside a project of type "Talkwalker": Radar reads the topics already configured there rather than rewriting the query. Each search spends credits from the Talkwalker contract (10 per call plus 1 per result).',
  },
  talkwalker_news: {
    label: 'Talkwalker (news)', color: '#0d9488',
    note: 'Editorial articles from the Talkwalker index: same acquisition as "Talkwalker", read as press coverage rather than social posts.',
  },
  gdelt: { label: 'GDELT', color: '#a78bfa' },
  reddit: { label: 'Reddit', color: '#ff4500' },
  bluesky: { label: 'Bluesky', color: '#38bdf8' },
  mastodon: { label: 'Mastodon', color: '#8b5cf6' },
  hackernews: { label: 'Hacker News', color: '#f97316' },
  youtube: { label: 'YouTube', color: '#ef4444' },
  x: { label: 'X (Twitter)', color: '#e2e8f0' },
  telegram: { label: 'Telegram', color: '#29b6f6' },
  rss: { label: 'RSS', color: '#fbbf24' },
  instagram: { label: 'Instagram', color: '#e1306c' },
  facebook: { label: 'Facebook', color: '#1877f2' },
  tiktok: { label: 'TikTok', color: '#fe2c55' },
  linkedin: {
    label: 'LinkedIn (page)', color: '#0a66c2',
    note: 'Posts from your own company page via the official LinkedIn API: full text and real metrics, but only your page.',
  },
  linkedin_web: {
    label: 'LinkedIn (web)', color: '#4c9ce8',
    note: 'Public LinkedIn posts and articles by anyone, found through the Tavily search index (official API): partial excerpts, no engagement metrics. A different acquisition model from "LinkedIn (page)".',
  },
  newsapi: { label: 'NewsAPI', color: '#14b8a6' },
  stackexchange: {
    label: 'Stack Exchange', color: '#f48024',
    note: 'Questions matching your terms in their title, across Stack Overflow and 5 other Stack Exchange communities (money, workplace, travel, parenting, general computing). Works with no key, at a shared low quota; add a free key to raise it.',
  },
  github: {
    label: 'GitHub', color: '#e2e8f0',
    note: 'Issues and pull requests matching your terms in their title, across all of public GitHub, with the full issue text and its reaction/comment counts. Automated bot-authored issues (changelog trackers, digests) are filtered out. Works with no key, at a low rate limit; add a free token to raise it.',
  },
  discord: {
    label: 'Discord', color: '#5865f2',
    note: 'Messages from the channels of a server you administer, via an official bot (watchlist model, like Facebook) — not search across other people’s servers, which Discord does not offer. Requires a free bot token and the Message Content Intent enabled for it.',
  },
  'sec-edgar': {
    label: 'SEC EDGAR', color: '#2c5aa0',
    note: 'Official SEC filings (8-K material events, 10-K/10-Q reports, DEF 14A proxy statements) by any US-listed company matching your terms — free, no key, US government data. Filing text is not included in the search results, so entries are built from the company, filing type and exhibit description, with a link to the full document.',
  },
  arxiv: {
    label: 'arXiv', color: '#b31b1b',
    note: 'Academic papers (CS, physics, math, quantitative biology and more) matching your terms, with the full abstract — official free API, no key. Server-side search does light stemming (verified live: "Claude" also matched an unrelated astronomy survey named "CLAUDS"), so results are re-checked here for a literal match in title or abstract.',
  },
  lemmy: {
    label: 'Lemmy', color: '#00bc8c',
    note: 'Posts and comments from Lemmy, the federated Reddit-like network, read through lemmy.world, which sees the content of the whole federation — free, no key. Server-side search is broad, so every result is re-checked here for a literal match in title or text.',
  },
  newsdata: {
    label: 'NewsData.io', color: '#6366f1',
    note: 'News from 100,000+ outlets in 80+ languages. Free key, 200 credits a day, commercial use allowed. One search per project per collection (10 articles, a 100-character boolean query); the remaining terms rotate on the next run. Full text is not in the free plan: articles are enriched afterwards like the others.',
  },
  podcastindex: {
    label: 'Podcast Index', color: '#f43f5e',
    note: 'Podcast episodes whose title or description mentions your terms, from the open Podcast Index directory (non-profit, free key and secret). The description is read, not the audio: an episode that only names the topic out loud is not found.',
  },
  upload: {
    label: 'Imported file', color: '#94a3b8',
    note: 'Rows imported from your Excel/CSV files: content, authors and dates are exactly what the file contains — nothing is collected from the web.',
  },
};
