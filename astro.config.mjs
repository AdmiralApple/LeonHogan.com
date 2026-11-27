// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// The dev server does not answer a folder with its index.html the way GitHub Pages does, so /reviews/ (the reviews app,
// a plain page in public/reviews/) would 404 under `npm run dev`; this sends it to the file.
const reviewsIndex = {
  name: 'reviews-index',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const [path, query] = (req.url || '').split('?');
      if (path === '/reviews' || path === '/reviews/') req.url = '/reviews/index.html' + (query ? '?' + query : '');
      next();
    });
  },
};

export default defineConfig({
  site: 'https://leonhogan.com',
  integrations: [sitemap()],
  vite: { plugins: [reviewsIndex] },
});
