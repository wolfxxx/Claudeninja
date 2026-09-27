/** Prefix paths for Vite's `base` (needed on GitHub Pages under /ClaudeNinja/). */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL;
  const clean = path.replace(/^\//, "");
  return `${base}${clean}`;
}
