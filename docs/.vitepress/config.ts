import { defineConfig } from 'vitepress';

// GitHub Pages serves the site from /<repository>/; the docs workflow sets DOCS_BASE accordingly.
const base = process.env['DOCS_BASE'] ?? '/';

export default defineConfig({
  title: 'keyset-kit',
  description:
    'Tiny, type-safe keyset (cursor) pagination for Prisma, TypeORM, Mongoose and Express.',
  base,
  cleanUrls: true,
  lastUpdated: true,
  // Working notes, not documentation.
  srcExclude: ['PROGRESS.md', 'RELEASING.md'],
  themeConfig: {
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/lavitsamson/keyset-kit' }],
    editLink: {
      pattern: 'https://github.com/lavitsamson/keyset-kit/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Design decisions', link: '/adr/0001-toolchain' },
      // VitePress prefixes the base; target _self makes it a full page load into the TypeDoc HTML.
      { text: 'API reference', link: '/api/index.html', target: '_self' },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Why keyset pagination', link: '/guide/why-keyset' },
          { text: 'Migrating from OFFSET', link: '/guide/migrating-from-offset' },
        ],
      },
      {
        text: 'Adapters',
        items: [
          { text: 'Prisma', link: '/guide/prisma' },
          { text: 'TypeORM', link: '/guide/typeorm' },
          { text: 'Mongoose', link: '/guide/mongoose' },
          { text: 'Express middleware', link: '/guide/express' },
        ],
      },
      {
        text: 'Concepts',
        items: [
          { text: 'Sorting & nulls', link: '/guide/sorting-and-nulls' },
          { text: 'Signed cursors', link: '/guide/signed-cursors' },
          { text: 'Error handling', link: '/guide/errors' },
          { text: 'FAQ', link: '/guide/faq' },
        ],
      },
      {
        text: 'Design decisions',
        items: [
          { text: '0001 Toolchain', link: '/adr/0001-toolchain' },
          { text: '0002 Cursor format & ordering', link: '/adr/0002-cursor-format-and-ordering' },
          { text: '0003 Adapter design', link: '/adr/0003-adapter-design' },
          { text: '0004 Express middleware', link: '/adr/0004-express-middleware' },
          { text: '0005 Release pipeline', link: '/adr/0005-release-pipeline' },
        ],
      },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Lavit Samson',
    },
  },
});
