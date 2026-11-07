/**
 * The app may be served from a subfolder (e.g. https://vxoratech.com/drujjwal/).
 * Vite sets BASE_URL from the build's `base`; it always ends with a slash.
 */
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');

/** An in-app path ("/print/...") as a URL path that includes the subfolder. */
export function appPath(path: string): string {
  return `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}
