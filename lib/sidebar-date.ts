/** SSR and hydration must show the same instant, regardless of browser timezone. */
export function formatSidebarUpdate(lastIngest: string | null): string {
  return lastIngest
    ? `Last update: ${new Date(lastIngest).toLocaleString('en-US', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg',
      })} SAST`
    : 'No data collected yet';
}

/** Article timestamps use the same fixed zone as the sidebar, including the year. */
export function formatArticleChecked(checkedAt: string): string {
  const date = new Date(checkedAt);
  return Number.isFinite(date.getTime()) ? `${date.toLocaleString('en-US', {
    year: 'numeric', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg',
  })} SAST` : 'Unknown';
}
