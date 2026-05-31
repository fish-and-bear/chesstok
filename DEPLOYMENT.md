# Deployment

Chesstok is a static site. The deploy root is this folder.

Preflight:

```sh
npm run check
npm run build
```

Local preview:

```sh
npm run preview
```

Then open `http://127.0.0.1:8899/`.

Static hosts:

- Cloudflare Pages: build command `npm run check && npm run build`, output
  directory `dist`.
- Cloudflare Workers: `wrangler.jsonc` mounts `chesstok.pages.dev` at
  `angelicanaguio.com/chesstok*`.
- Netlify: build command `npm run build`, publish directory `dist`. `_headers` supplies security
  headers.
- Vercel: deploy this folder. `vercel.json` supplies security headers.
- GitHub Pages: publish `dist` as static files. GitHub Pages will not apply
  `_headers`, but the app still has a CSP meta tag.

Do not deploy the `work/` folder. It contains local audit scripts and temporary
files, not production assets.
