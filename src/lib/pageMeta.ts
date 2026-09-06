import { useEffect } from 'react';

interface PageMetaOptions {
  title: string;
  description: string;
  path: string;
  robots?: string;
}

function setMeta(selector: string, attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

export function usePageMeta({
  title,
  description,
  path,
  robots = 'index,follow',
}: PageMetaOptions) {
  useEffect(() => {
    const configuredOrigin = String(import.meta.env.VITE_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');
    const origin = configuredOrigin || window.location.origin;
    const canonicalUrl = `${origin}${path.startsWith('/') ? path : `/${path}`}`;

    document.title = title;
    setMeta('meta[name="description"]', 'name', 'description', description);
    setMeta('meta[name="robots"]', 'name', 'robots', robots);
    setMeta('meta[property="og:title"]', 'property', 'og:title', title);
    setMeta('meta[property="og:description"]', 'property', 'og:description', description);
    setMeta('meta[property="og:type"]', 'property', 'og:type', 'website');
    setMeta('meta[property="og:url"]', 'property', 'og:url', canonicalUrl);
    setMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary');

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;
  }, [description, path, robots, title]);
}
