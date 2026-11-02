# Field Notes

The fieldnotes.dev site (Next.js App Router).

```sh
npm run dev
npm run build
npm test        # builds, then runs the integration tests in test/ against `next start`
```

- Posts come from the CMS export in `content/posts.json` and are cached with the `posts` tag. The
  CMS calls `POST /api/revalidate` (header `x-cms-secret`, env `CMS_WEBHOOK_SECRET`) after every
  publish, and the next page view shows the new content.
- Post sitemaps are split by 50,000 URLs: `/posts/sitemap/0.xml`, `/posts/sitemap/1.xml`, ...
- Photos are served from `images.fieldnotes.dev` through `next/image`. The hero photo uses quality 90.
- The `theme` cookie (`light` or `dark`) sets the class on `<html>`.
