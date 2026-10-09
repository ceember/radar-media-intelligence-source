import { selectedPublicUrl } from './competitor-page';

export type CompetitorSeed = { projectId: number; projectName: string; buttonLabel: string;
  pages: { entity: string; label: string; url: string }[] };

export function configuredCompetitorSeed(project: { id: number; name: string }, raw = process.env.RADAR_COMPETITOR_SEED_JSON): CompetitorSeed | null {
  if (!raw || Buffer.byteLength(raw, 'utf8') > 24_000) return null;
  try {
    const value = JSON.parse(raw);
    if (!Number.isSafeInteger(value.projectId) || value.projectId <= 0 || value.projectId !== project.id
        || typeof value.projectName !== 'string' || value.projectName !== project.name
        || typeof value.buttonLabel !== 'string' || !value.buttonLabel.trim() || value.buttonLabel.length > 160
        || !Array.isArray(value.pages) || !value.pages.length || value.pages.length > 10) return null;
    const pages = value.pages.map((page: Record<string, unknown>) => {
      if (!page || typeof page.entity !== 'string' || !page.entity.trim() || page.entity.length > 120
          || typeof page.label !== 'string' || !page.label.trim() || page.label.length > 120) throw Error('Invalid selection');
      return { entity: page.entity, label: page.label, url: selectedPublicUrl(page.url) };
    });
    if (new Set(pages.map((page: { url: string }) => page.url)).size !== pages.length) return null;
    return { projectId: value.projectId, projectName: value.projectName, buttonLabel: value.buttonLabel, pages };
  } catch { return null; }
}

export function configuredCompetitorAdLibraryNote(raw = process.env.RADAR_COMPETITOR_SEED_JSON): string | null {
  if (!raw || Buffer.byteLength(raw, 'utf8') > 24_000) return null;
  try {
    const value = JSON.parse(raw);
    return typeof value?.adLibraryNote === 'string' && value.adLibraryNote.trim() && value.adLibraryNote.length <= 500
      ? value.adLibraryNote : null;
  } catch { return null; }
}
