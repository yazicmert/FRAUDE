/** Mum-F logosu — uygulama ikonuyla aynı harf. */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true">
      <rect x="32" y="32" width="960" height="960" rx="212" fill="#10151d" />
      <rect x="326" y="164" width="16" height="696" rx="8" fill="#00d488" opacity="0.9" />
      <rect x="350" y="462" width="268" height="112" rx="26" fill="#f0554a" />
      <rect x="618" y="510" width="44" height="16" rx="8" fill="#f0554a" opacity="0.9" />
      <rect x="278" y="212" width="424" height="112" rx="26" fill="#00d488" />
      <rect x="702" y="260" width="44" height="16" rx="8" fill="#00d488" opacity="0.9" />
      <rect x="278" y="212" width="112" height="600" rx="26" fill="#00d488" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="green">F</span>RAUDE
    </span>
  );
}
