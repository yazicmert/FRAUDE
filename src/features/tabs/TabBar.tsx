interface TabLike {
  id: string;
  title: string;
}

interface TabBarProps {
  tabs: TabLike[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
}

export default function TabBar({ tabs, activeTabId, onSelect, onClose }: TabBarProps) {
  return (
    <div className="tabbar">
      {tabs.map((tab) => {
        const isDynamic = tab.id.startsWith('ticker-') || tab.id.startsWith('index-');
        return (
          <div 
            key={tab.id} 
            className={`tab ${activeTabId === tab.id ? 'active' : ''}`} 
            style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingRight: isDynamic ? '8px' : undefined }}
          >
            <button
              type="button"
              onClick={() => onSelect(tab.id)}
              style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 'inherit', fontFamily: 'inherit' }}
            >
              {tab.title}
            </button>
            {isDynamic && onClose && (
              <button 
                type="button" 
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 2px', fontSize: '0.8rem', opacity: 0.6 }}
                title="Kapat"
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
