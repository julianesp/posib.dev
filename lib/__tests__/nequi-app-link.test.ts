import { detectNequiPlatform, nequiAppLink, NEQUI_APP_STORE_URL } from '../nequi-app-link';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A145M) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';

describe('botón "Abrir Nequi" del checkout', () => {
  it('reconoce el celular del cliente', () => {
    expect(detectNequiPlatform(ANDROID)).toBe('android');
    expect(detectNequiPlatform(IPHONE)).toBe('ios');
    expect(detectNequiPlatform(IPAD, 5)).toBe('ios');
    expect(detectNequiPlatform(IPAD, 0)).toBe('desktop'); // Mac de verdad
    expect(detectNequiPlatform(WINDOWS)).toBe('desktop');
  });

  it('en Android abre la app de Nequi y, si no la tiene, Play Store', () => {
    const link = nequiAppLink('android')!;
    expect(link.startsWith('intent:#Intent;')).toBe(true);
    expect(link).toContain('package=com.nequi.MobileApp;');
    expect(link).toContain('S.browser_fallback_url=' + encodeURIComponent('https://play.google.com/store/apps/details?id=com.nequi.MobileApp'));
    expect(link.endsWith(';end')).toBe(true);
  });

  it('en iPhone lleva a Nequi en App Store; en computador no hay botón', () => {
    expect(nequiAppLink('ios')).toBe(NEQUI_APP_STORE_URL);
    expect(nequiAppLink('desktop')).toBeNull();
  });
});
