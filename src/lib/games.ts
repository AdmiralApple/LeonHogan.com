import { getCollection } from 'astro:content';

/** All games, featured first, then newest first. */
export async function getGames() {
  const games = await getCollection('games');
  return games.sort(
    (a, b) =>
      Number(b.data.featured) - Number(a.data.featured) ||
      b.data.year - a.data.year ||
      a.data.title.localeCompare(b.data.title),
  );
}

export async function getPosts() {
  const posts = await getCollection('blog', ({ data }) => import.meta.env.DEV || !data.draft);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}
