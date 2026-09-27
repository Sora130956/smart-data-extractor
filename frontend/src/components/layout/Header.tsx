import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useUiStore } from '@/store/uiStore';
import { LANGUAGES } from '@/i18n';

const GITHUB_URL = 'https://github.com/Sora130956/smart-data-extractor';

function LanguageToggle() {
  const { i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? 'en';

  return (
    <div
      className="inline-flex overflow-hidden rounded-token border border-border"
      role="group"
      aria-label="Language"
    >
      {LANGUAGES.map((lng) => {
        const active = current === lng;
        return (
          <button
            key={lng}
            type="button"
            aria-pressed={active}
            onClick={() => void i18n.changeLanguage(lng)}
            className={`px-2.5 py-1 text-caption font-medium transition-colors ${
              active
                ? 'bg-brand text-on-brand'
                : 'bg-surface text-text-muted hover:bg-surface-muted'
            }`}
          >
            {lng === 'en' ? 'EN' : '中文'}
          </button>
        );
      })}
    </div>
  );
}

export function Header() {
  const { t } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
      <div className="flex items-center gap-2.5">
        <div className="grid size-7 place-items-center rounded-token bg-brand text-caption font-bold text-on-brand">
          SD
        </div>
        <div>
          <h1 className="text-title font-semibold">{t('app.title')}</h1>
          <p className="text-caption text-text-muted">{t('app.tagline')}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={toggleTheme} aria-label={t('header.theme')}>
          <span aria-hidden>◐</span>
          {theme === 'dark' ? t('header.themeDark') : t('header.themeLight')}
        </Button>
        <LanguageToggle />
        <Button size="sm">{t('header.history')}</Button>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-token border border-border bg-surface px-2.5 py-1 text-caption font-medium text-text transition-colors hover:bg-surface-muted"
        >
          {t('header.github')}
        </a>
      </div>
    </header>
  );
}
