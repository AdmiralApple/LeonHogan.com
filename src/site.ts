// Site-wide settings. Edit these to change your name, tagline and links.
export const SITE = {
  name: 'Leon Hogan',
  tagline: 'I make games, play a lot of other people’s, and write about both.',
  description: 'Games made by Leon Hogan, plus a log of every game he’s played, with scores, and a personal blog.',
  url: 'https://leonhogan.com',
};

export const SOCIALS = [
  { label: 'itch.io', href: 'https://elwood-hogan.itch.io/' },
  { label: 'GitHub', href: 'https://github.com/AdmiralApple' },
  { label: 'Portfolio', href: 'https://elwoodhogan.com' },
];

// Combobulate's backend (the Cloudflare Worker in combobulate-api/). While running `npm run dev`
// the page talks to a local Worker on http://localhost:8787 instead.
export const COMBOBULATE_API = 'https://combobulate-api.combobulate-api.workers.dev';

export const NAV = [
  { label: 'Games', href: '/games/' },
  { label: 'Reviews', href: '/reviews/' },
  { label: 'Blog', href: '/blog/' },
  { label: 'About', href: '/about/' },
];

export const formatDate = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

// Score → colour band used by score badges.
export const scoreBand = (n: number) => (n >= 8 ? 'great' : n >= 6 ? 'good' : n >= 4 ? 'meh' : 'bad');

export const KIND_LABEL: Record<string, string> = {
  game: 'Game',
  jam: 'Game jam',
  toy: 'Toy',
  tool: 'Tool',
};

export const STATUS_LABEL: Record<string, string> = {
  released: 'Released',
  'in-development': 'In development',
  'on-hold': 'On hold',
};
