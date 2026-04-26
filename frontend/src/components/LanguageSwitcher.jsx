import { apiFetch } from "../auth.js";
import { useTranslation } from 'react-i18next';
import { useRef, useEffect } from 'react';

export default function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const detailsRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (detailsRef.current && !detailsRef.current.contains(e.target)) {
        detailsRef.current.open = false;
      }
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, []);

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
    if (detailsRef.current) detailsRef.current.open = false;
  };

  const langIcons = { nl: '🇳🇱', en: '🇬🇧' };
  const currentLang = i18n.language.split('-')[0] || 'nl';
  const isNl = currentLang === 'nl';

  return (
    <details ref={detailsRef} className="language-picker">
      <summary
        className="btn btn-ghost btn-sm language-picker-summary"
        style={{ gap: 4, fontSize: 12 }}
        title={t('language.select')}
      >
        {langIcons[currentLang] || '🌐'} {isNl ? 'NL' : 'EN'}
      </summary>
      <div className="language-picker-menu">
        <button
          className={`language-picker-item${currentLang === 'nl' ? ' active' : ''}`}
          onClick={() => changeLanguage('nl')}
        >
          🇳🇱 {t('language.nl')}
        </button>
        <button
          className={`language-picker-item${currentLang === 'en' ? ' active' : ''}`}
          onClick={() => changeLanguage('en')}
        >
          🇬🇧 {t('language.en')}
        </button>
      </div>
    </details>
  );
}
