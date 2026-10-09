export function SourceFooter() {
  const buildCommit = process.env.NEXT_PUBLIC_SOURCE_COMMIT_SHA ?? '';
  const shortSha = buildCommit.length === 7 && /^[a-f0-9]{7}$/i.test(buildCommit) ? buildCommit.toLowerCase() : '';
  const repository = 'https://github.com/ceember/radar-media-intelligence-source';

  return (
    <footer className="mt-8 flex flex-wrap items-center justify-center gap-2 border-t border-[var(--border)] py-4 text-xs text-slate-400">
      <a href={shortSha ? `${repository}/tree/prod-${shortSha}` : repository}
        target="_blank" rel="noopener noreferrer"
        className="rounded px-2 py-1 text-sky-300 transition hover:text-sky-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">
        Source
      </a>
      {shortSha && <span className="font-mono">{shortSha}</span>}
    </footer>
  );
}
