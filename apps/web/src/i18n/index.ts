// Phase 20-H: react-i18next initialisation (en / hi) + en-IN numbers & DD-MM-YYYY formatting.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import hi from './hi.json';

const STORAGE_KEY = 'rhai.locale';

export type SupportedLocale = 'en' | 'hi';

function initialLocale(): SupportedLocale {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'hi' || saved === 'en') return saved;
  } catch {
    // SSR / restricted storage fallback
  }
  return 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
  },
  lng: initialLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export async function setAppLocale(locale: SupportedLocale): Promise<void> {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore storage errors
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
  await i18n.changeLanguage(locale);
}

/** Formats money in Indian numbering (en-IN), e.g., ₹ 1,25,000.00. */
export function formatInr(amount: number | string): string {
  const num = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(num)) return '₹ 0.00';
  return `₹ ${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Formats ISO date/timestamp as DD-MM-YYYY (Asia/Kolkata). */
export function formatDmy(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .format(d)
    .replace(/\//g, '-');
}

export default i18n;

