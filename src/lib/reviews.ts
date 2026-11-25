import { getCollection } from 'astro:content';

export type Review = {
  id: string;
  title: string;
  status: 'Completed' | 'Playing' | 'Dropped' | 'On Hold' | 'Plan to';
  rating: number | null;
  date: string | null;
  feelings: string | null;
  cover?: string;
};

// The cover manifest is keyed by entry id, with a plain-title fallback.
const titleKey = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function getReviews(): Promise<Review[]> {
  const [entries, covers] = await Promise.all([getCollection('reviews'), getCollection('covers')]);
  const coverMap = new Map(covers.map((c) => [c.id, c.data.url]));

  return entries
    .map(({ data }) => ({
      ...data,
      cover: coverMap.get(data.id) ?? coverMap.get(titleKey(data.title)),
    }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title));
}

/** Everything you've actually played (not the backlog), scored or not. */
export const played = (all: Review[]) => all.filter((r) => r.status !== 'Plan to');

/** Played entries that have a score. */
export const rated = (all: Review[]) => played(all).filter((r) => r.rating !== null);
