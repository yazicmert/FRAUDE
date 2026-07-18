import { BrandMark } from '../components/Brand';
import CandleTape from '../components/CandleTape';
import { navigate } from '../lib/router';

const DOWNLOAD_URL = 'https://github.com/yazicmert/FRAUDE/releases/latest';

const FEATURES = [
  {
    icon: '📈',
    title: 'Canlı Piyasa Verisi',
    text: 'BIST hisseleri, endeksler, emtia ve döviz — İş Yatırım ve Yahoo Finance kaynaklarından, ~15 dk gecikmeli kotasyon şeridiyle.',
  },
  {
    icon: '🔍',
    title: 'Teknik Tarayıcı',
    text: 'RSI, hacim ve temel oranlarla FQL sorgu dili üzerinden tüm BIST evrenini saniyeler içinde tarayın.',
  },
  {
    icon: '📢',
    title: 'KAP İzleme Radarı',
    text: 'Takip listenizdeki şirketlerin KAP bildirimlerini arka planda izler; ortaklık değişimi ve yeni iş ilişkilerinde anında bildirim üretir.',
  },
  {
    icon: '💼',
    title: 'Fon Analizi',
    text: 'TEFAS fonlarının getirileri, varlık dağılımları ve KAP portföy raporlarından fon içi tek tek varlık kırılımı.',
  },
  {
    icon: '🤖',
    title: 'Yapay Zeka Araştırma',
    text: 'Kendi API anahtarınızla çalışan AI ajanları: KAP bildirimlerini, haberleri ve fiyatları okuyup Türkçe özet notlar hazırlar.',
  },
  {
    icon: '🗓️',
    title: 'Ekonomik Takvim',
    text: 'TCMB faiz kararları, enflasyon ve makro veriler; temettü, bedelli/bedelsiz ve halka arz takvimiyle birlikte.',
  },
];

export default function Landing() {
  return (
    <>
      <section className="hero" id="top">
        <div className="hero-grid" />
        <CandleTape variant="far" />
        <CandleTape variant="near" />
        <div className="hero-inner">
          <div className="hero-logo">
            <BrandMark size={96} />
          </div>
          <h1>
            Borsa İstanbul için
            <br />
            <span className="accent">modern araştırma terminali</span>
          </h1>
          <p className="lead">
            Canlı piyasa verisi, KAP izleme, fon analizi ve yapay zeka destekli araştırma —
            hepsi tek bir masaüstü uygulamasında. Verileriniz cihazınızda, hızınız terminal
            seviyesinde.
          </p>
          <div className="hero-ctas">
            <a className="btn btn-primary" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
              ⬇ Uygulamayı İndir
            </a>
            <button className="btn" onClick={() => navigate('/hesap')}>
              Lisans Talep Et
            </button>
          </div>
          <p className="hero-note">macOS için hazır · Lisans anahtarıyla etkinleştirilir</p>
        </div>
      </section>

      <section className="section" id="ozellikler">
        <h2>Araştırma masanız, tek uygulamada</h2>
        <p className="sub">
          FRAUDE, dağınık sekmeler yerine tek bir çalışma alanında piyasayı izlemeniz,
          taramanız ve araştırmanız için tasarlandı.
        </p>
        <div className="feature-grid">
          {FEATURES.map((feature) => (
            <div className="feature-card" key={feature.title}>
              <div className="icon">{feature.icon}</div>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="baslangic">
        <h2>Üç adımda başlayın</h2>
        <p className="sub">Kurulumdan ilk taramaya birkaç dakika.</p>
        <div className="steps">
          <div className="step">
            <div className="num">1</div>
            <h3>Uygulamayı indirin</h3>
            <p>macOS sürümünü indirip kurun; uygulama açılışta sizi karşılar.</p>
          </div>
          <div className="step">
            <div className="num">2</div>
            <h3>Hesap oluşturun</h3>
            <p>E-postanızla kaydolun ve bu siteden lisans talebinizi iletin.</p>
          </div>
          <div className="step">
            <div className="num">3</div>
            <h3>Lisansı etkinleştirin</h3>
            <p>Onaylanan anahtarınızı uygulamaya girin; terminal tamamen açılır.</p>
          </div>
        </div>
      </section>

      <section className="download-band" id="indir">
        <h2>FRAUDE'yi masaüstünüze kurun</h2>
        <p>Erişim lisans anahtarıyla sağlanır; anahtarınız yoksa hesabınızdan talep edin.</p>
        <div className="platform-btns">
          <a className="btn btn-primary" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
             macOS için indir
          </a>
          <button className="btn" onClick={() => navigate('/hesap')}>
            Lisans Talep Et →
          </button>
        </div>
      </section>
    </>
  );
}
