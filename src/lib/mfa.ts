import type { UserRole } from '@/hooks/useAuth';

export type AssuranceLevel = 'aal1' | 'aal2' | null;

export function needsMfaChallenge(
  currentLevel: AssuranceLevel,
  nextLevel: AssuranceLevel,
): boolean {
  return nextLevel === 'aal2' && currentLevel !== 'aal2';
}

export function authenticatedHome(role: UserRole): string {
  if (role === 'consulente') return '/consulente';
  if (role === 'banca') return '/banca';
  return '/admin/dashboard';
}

export function normalizeTotpCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

export function totpQrSource(value: string): string {
  if (value.startsWith('data:image/')) return value;
  return `data:image/svg+xml;utf-8,${encodeURIComponent(value)}`;
}

export function describeUserAgent(userAgent: string): string {
  const device = /Mobile|Android|iPhone|iPad/i.test(userAgent)
    ? 'Dispositivo mobile'
    : /Windows/i.test(userAgent)
      ? 'Windows'
      : /Macintosh|Mac OS/i.test(userAgent)
        ? 'Mac'
        : /Linux/i.test(userAgent)
          ? 'Linux'
          : 'Dispositivo non identificato';

  const browser = /Edg\//i.test(userAgent)
    ? 'Edge'
    : /Firefox\//i.test(userAgent)
      ? 'Firefox'
      : /Chrome\//i.test(userAgent)
        ? 'Chrome'
        : /Safari\//i.test(userAgent)
          ? 'Safari'
          : '';

  return browser ? `${device} · ${browser}` : device;
}
