# Deployment

Move Rush is a static site. The deploy root is this folder.

Preflight:

```sh
npm run check
```

Local preview:

```sh
npm run preview
```

Then open `http://127.0.0.1:8899/`.

Static hosts:

- Cloudflare Pages: set the project root to this folder and leave build command
  empty, or use `npm run check` as the build command.
- Netlify: set publish directory to this folder. `_headers` supplies security
  headers.
- Vercel: deploy this folder. `vercel.json` supplies security headers.
- GitHub Pages: publish this folder as static files. GitHub Pages will not apply
  `_headers`, but the app still has a CSP meta tag.

Do not deploy the `work/` folder. It contains local audit scripts and temporary
files, not production assets.
