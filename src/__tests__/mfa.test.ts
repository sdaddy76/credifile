import {
  authenticatedHome,
  describeUserAgent,
  needsMfaChallenge,
  normalizeTotpCode,
  totpQrSource,
} from '@/lib/mfa';

describe('MFA Credifile', () => {
  it('richiede il secondo fattore quando la sessione può salire da AAL1 ad AAL2', () => {
    expect(needsMfaChallenge('aal1', 'aal2')).toBe(true);
    expect(needsMfaChallenge('aal2', 'aal2')).toBe(false);
    expect(needsMfaChallenge('aal1', 'aal1')).toBe(false);
  });

  it('normalizza il codice temporaneo a sei cifre', () => {
    expect(normalizeTotpCode('12 34-5678')).toBe('123456');
  });

  it('genera una sorgente immagine sicura per il QR SVG', () => {
    expect(totpQrSource('<svg viewBox="0 0 10 10"></svg>')).toMatch(
      /^data:image\/svg\+xml;utf-8,/,
    );
    expect(totpQrSource('data:image/svg+xml;base64,abc')).toBe(
      'data:image/svg+xml;base64,abc',
    );
  });

  it('indirizza ogni ruolo al proprio portale', () => {
    expect(authenticatedHome('consulente')).toBe('/consulente');
    expect(authenticatedHome('banca')).toBe('/banca');
    expect(authenticatedHome('agente')).toBe('/admin/dashboard');
  });

  it('riassume dispositivo e browser dai log di accesso', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0')).toBe(
      'Windows · Chrome',
    );
    expect(describeUserAgent('Mozilla/5.0 (iPhone) Version/17.0 Safari/605.1')).toBe(
      'Dispositivo mobile · Safari',
    );
  });
});
