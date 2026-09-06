export function getAppOrigin() {
  const configured = String(import.meta.env.VITE_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');
  if (configured) return configured;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'https://credifile-eosin.vercel.app';
}

export function buildAppUrl(path: string) {
  return `${getAppOrigin()}${path.startsWith('/') ? path : `/${path}`}`;
}
