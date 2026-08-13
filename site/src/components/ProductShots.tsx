import { useRef, useState } from 'react';
import { navigate } from '../lib/router';
import { useI18n } from '../lib/i18n';
import { ALL_MODULES } from '../lib/product';

/**
 * Kahramanın altındaki sekmeli ekran görüntüsü. Görüntüler uygulamanın
 * kendisinden çekildi ve modül sayfalarıyla aynı dosyaları kullanır.
 *
 * Sekmeler WAI-ARIA "tabs with manual activation" kalıbını izler: ok tuşları
 * odağı taşır, seçim Enter/Space ile olur. Görüntüler DOM'da kalır; ilki
 * hemen, diğerleri tembel yüklenir — sekme değişince bekleme olmasın.
 */
const TAB_SLUGS = ['pano', 'teknik-tarayici', 'bilgi-deposu', 'fonlar'];

export default function ProductShots() {
  const { t, lang } = useI18n();
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const tabs = TAB_SLUGS.map((slug) => ALL_MODULES.find((m) => m.slug === slug)).filter(
    (m): m is NonNullable<typeof m> => Boolean(m?.shot),
  );

  if (!tabs.length) return null;

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + tabs.length) % tabs.length;
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="ps">
      <div className="ps-tabs" role="tablist" aria-label={t('shotTitle')}>
        {tabs.map((mod, i) => (
          <button
            key={mod.slug}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`ps-tab-${mod.slug}`}
            aria-selected={i === active}
            aria-controls={`ps-panel-${mod.slug}`}
            tabIndex={i === active ? 0 : -1}
            className={`ps-tab${i === active ? ' ps-tab-on' : ''}`}
            onClick={() => setActive(i)}
            onKeyDown={(event) => onKeyDown(event, i)}
          >
            <span className="ps-tab-code" aria-hidden="true">
              {mod.code}
            </span>
            {mod.name[lang]}
          </button>
        ))}
      </div>

      <div className="ps-frame">
        {tabs.map((mod, i) => (
          <div
            key={mod.slug}
            role="tabpanel"
            id={`ps-panel-${mod.slug}`}
            aria-labelledby={`ps-tab-${mod.slug}`}
            hidden={i !== active}
          >
            <img
              src={`/shots/${mod.shot}.webp`}
              alt={`${mod.name[lang]} — ${mod.desc[lang]}`}
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
            />
          </div>
        ))}
        <p className="ps-caption">
          <span>{t('shotCaption')}</span>
          <a
            href={`/modul/${tabs[active].slug}`}
            onClick={(event) => {
              event.preventDefault();
              navigate(`/modul/${tabs[active].slug}`);
            }}
          >
            {tabs[active].name[lang]} →
          </a>
        </p>
      </div>
    </div>
  );
}
