/** Turns a title into a URL slug: lowercase words joined by hyphens. */
export function slugify(title) {
  return title.toLowerCase().replace(/ /g, '-')
}
