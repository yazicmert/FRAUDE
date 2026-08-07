import { useEffect, useMemo, useRef, useState } from 'react';
import { askAi, listAiKeys } from '../../api/tauriClient';
import { getCopilotContext, setCopilotActivePayload, subscribeCopilot, type GlobalUserContext } from './userContext';
import './GlobalAiCopilot.css';

interface ChatMsg {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

// Canlı Daktilo (Typewriter) İpucu Engine
function useTypewriterPlaceholder(context: GlobalUserContext, attachedImage: string | null) {
  const [displayText, setDisplayText] = useState('');
  const [hasAiKey, setHasAiKey] = useState(false);

  useEffect(() => {
    listAiKeys()
      .then((keys) => {
        if (Array.isArray(keys) && keys.length > 0) {
          setHasAiKey(true);
        }
      })
      .catch(() => setHasAiKey(false));
  }, []);

  const prompts = useMemo(() => {
    if (attachedImage) {
      return ['🖼️ Görsel eklendi. Sorunuzu yazıp Enter\'a basın...'];
    }

    const payload = context.activePayload;
    if (payload?.type === 'AI_VARIABLE_COMPARISON') {
      const summary = payload.comparisonSummary || 'Seçili 2 mali kalem';
      if (hasAiKey) {
        return [
          `✨ [AI BAĞLI] ${summary} değişiminin nedenini sorun...`,
          `⚡ KAP haberlerini ve SPK duyurularını bu 2 dönem için araştırtın...`,
          `🔍 Net Kâr ve Hasılat farkını FRAUDE AI ile yorumlatın...`,
        ];
      }
      return [
        `🤖 ${summary}. Değişimin nedenlerini sorun...`,
        `⚡ KAP haberlerini ve SPK duyurularını bu 2 dönem için araştırtın...`,
        `🔍 Kâr marjları ve Hasılat farkını yorumlatın...`,
      ];
    }

    const mod = (context.activeModule || '').toLowerCase();
    const actionList = context.recentActions || [];
    const lastAction = actionList[0]?.action || '';

    if (mod.includes('bilanço') || mod.includes('finansal') || mod.includes('ticker')) {
      const tickerMatch = lastAction.match(/\b([A-Z]{4,5})\b/) || lastAction.match(/\b([A-Z]{3,5}\.IS)\b/);
      const activeTicker = tickerMatch ? tickerMatch[0].replace('.IS', '') : 'Hisse';

      if (hasAiKey) {
        return [
          `✨ [AI BAĞLI] ${activeTicker} net kâr artış nedenini sorun...`,
          `⚡ Cmd+F+Tık ile 2 dönemi KAP analiz ettirin...`,
          `📊 ${activeTicker} brüt kâr marjı sapmasını sorun...`,
          `💡 Serbest nakit akışını AI ile analiz ettirin...`,
        ];
      }
      return [
        `Cmd+F+Tık ile 2 dönemi seçip KAP inceletin...`,
        `Net Kâr ve Hasılat büyüme nedenini sorun...`,
        `Brüt Kâr Marjı ile Faaliyet sapmasını sorun...`,
        `Serbest Nakit Akışını AI ile analiz ettirin...`,
      ];
    }

    if (mod.includes('tarama') || mod.includes('screener')) {
      if (hasAiKey) {
        return [
          `✨ [AI BAĞLI] Düşük F/K ve yüksek ROE hisseleri sorun...`,
          `⚡ Nakit zengini ve borçsuz şirketleri bulun...`,
          `📊 Sektörünün üstünde büyüyen hisseleri sorun...`,
        ];
      }
      return [
        `Düşük F/K ve yüksek ROE hisseleri bulun...`,
        `Nakit zengini ve borçsuz şirketleri bulun...`,
        `Sektörünün üstünde büyüyen hisseleri sorun...`,
      ];
    }

    if (hasAiKey) {
      return [
        `✨ [AI BAĞLI] BIST100 ve öne çıkan sektörleri sorun...`,
        `⚡ USD/TRY, Altın ve Borsa korelasyonunu sorun...`,
        `🖼️ Ekran görüntüsü yapıştırın (Cmd+V)...`,
        `💡 İstenen hissenin bilançosunu analiz ettirin...`,
      ];
    }

    return [
      `BIST100 ve öne çıkan sektörleri sorun...`,
      `USD/TRY, Altın ve Borsa korelasyonunu sorun...`,
      `Ekran görüntüsü yapıştırın (Cmd+V)...`,
      `İstenen hissenin bilançosunu analiz ettirin...`,
    ];
  }, [context.activeModule, context.activePayload, context.recentActions, attachedImage, hasAiKey]);

  useEffect(() => {
    let isMounted = true;
    let promptIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const animate = () => {
      if (!isMounted || prompts.length === 0) return;

      const currentPrompt = prompts[promptIndex % prompts.length];

      if (!isDeleting) {
        setDisplayText(currentPrompt.slice(0, charIndex + 1));
        charIndex++;
        if (charIndex >= currentPrompt.length) {
          isDeleting = true;
          timeoutId = setTimeout(animate, 2200);
          return;
        }
        timeoutId = setTimeout(animate, 35);
      } else {
        setDisplayText(currentPrompt.slice(0, charIndex - 1));
        charIndex--;
        if (charIndex <= 0) {
          isDeleting = false;
          promptIndex++;
          timeoutId = setTimeout(animate, 350);
          return;
        }
        timeoutId = setTimeout(animate, 18);
      }
    };

    animate();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [prompts]);

  return { displayText, allPrompts: prompts, hasAiKey };
}

export default function GlobalAiCopilot() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [context, setContext] = useState<GlobalUserContext>(() => getCopilotContext());
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Gerçek Backend AI Key ve Model Bilgileri
  const [aiKeys, setAiKeys] = useState<import('../../types').AiKeyRecord[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-1.5-flash');
  const [effortLevel, setEffortLevel] = useState<'low' | 'medium' | 'high'>('medium');
  const [selectedAgent, setSelectedAgent] = useState<string>('kap_inspector');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const { displayText: typewriterText, allPrompts, hasAiKey } = useTypewriterPlaceholder(context, attachedImage);

  // Backend'den Gerçek Bağlı AI Anahtarlarını Yükle
  useEffect(() => {
    listAiKeys()
      .then((keys) => {
        setAiKeys(keys);
        const activeKey = keys.find((k) => k.is_default) || keys.find((k) => k.enabled) || keys[0];
        if (activeKey) {
          setSelectedKeyId(activeKey.id);
          setSelectedModel(activeKey.default_model || activeKey.provider || 'gemini-1.5-flash');
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return subscribeCopilot(() => {
      setContext({ ...getCopilotContext() });
    });
  }, []);

  // Diğer modüllerden (Cmd+F / Mali Tablo) gelen AI sorularını otomatik yakala
  useEffect(() => {
    const handleCopilotPrompt = (e: Event) => {
      const customEvt = e as CustomEvent<{ prompt: string }>;
      if (customEvt.detail?.prompt) {
        setIsExpanded(true);
        void handleSend(customEvt.detail.prompt);
      }
    };
    window.addEventListener('fraude-copilot-send-prompt', handleCopilotPrompt);
    return () => window.removeEventListener('fraude-copilot-send-prompt', handleCopilotPrompt);
  }, []);

  useEffect(() => {
    if (isExpanded || isHovered) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isExpanded, isHovered]);

  // Evrensel Cmd + F Tuşu Takipçisi (Tüm Modüller İçin)
  const isCmdFPressedRef = useRef(false);
  const [isCmdFPressed, setIsCmdFPressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const k = e.key ? e.key.toLowerCase() : '';
      if ((e.metaKey || e.ctrlKey) && k === 'f') {
        isCmdFPressedRef.current = true;
        setIsCmdFPressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const k = e.key ? e.key.toLowerCase() : '';
      if (k === 'f' || (!e.metaKey && !e.ctrlKey)) {
        isCmdFPressedRef.current = false;
        setIsCmdFPressed(false);
      }
    };
    const handleBlur = () => {
      isCmdFPressedRef.current = false;
      setIsCmdFPressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Chatbot açıkken arka planı blurlama (Cmd+F basılınca blur kalkar)
  useEffect(() => {
    const shouldBlur = isExpanded && !isCmdFPressed;
    document.body.classList.toggle('copilot-blurred-body', shouldBlur);
    return () => {
      document.body.classList.remove('copilot-blurred-body');
    };
  }, [isExpanded, isCmdFPressed]);

  // Arka planda hamle takip & Evrensel Cmd + F + Tık Seçici
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.copilot-container')) return;

      // EVRENSEL Cmd + F + TIK SEÇİM SİSTEMİ (TÜM MODÜLLERDE AKTİF)
      if ((e.metaKey || e.ctrlKey) && isCmdFPressedRef.current) {
        const selectable = target.closest(
          'tr, td, th, .upd-card, .kap-item, .st-btn, .metric-card, .crypto-card, .fund-card, .tefas-item, [data-action], .chip, .card, button, a'
        ) as HTMLElement | null;

        if (selectable) {
          e.preventDefault();
          e.stopPropagation();

          const isSelected = selectable.classList.contains('fraude-cmd-f-selected');
          if (isSelected) {
            selectable.classList.remove('fraude-cmd-f-selected');
          } else {
            selectable.classList.add('fraude-cmd-f-selected');
          }

          const selectedEls = Array.from(document.querySelectorAll('.fraude-cmd-f-selected'));
          const selectedItems = selectedEls.map((el, idx) => {
            const raw = (el.getAttribute('data-action') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100);
            return { id: `item-${idx}`, label: raw };
          });

          if (selectedItems.length >= 2) {
            const item1 = selectedItems[selectedItems.length - 2].label;
            const item2 = selectedItems[selectedItems.length - 1].label;
            setCopilotActivePayload({
              compareMode: true,
              item1,
              item2,
              allItems: selectedItems.map((i) => i.label),
            });

            const prompt = `🤖 FRAUDE AI KARŞILAŞTIRMA & ANALİZ: Ekranda seçilen "${item1}" ile "${item2}" ögelerini detaylıca finansal açıdan karşılaştır, korelasyonu ve farkları açıkla.`;
            const customEvt = new CustomEvent('fraude-copilot-send-prompt', { detail: { prompt } });
            window.dispatchEvent(customEvt);
          } else if (selectedItems.length < 2) {
            setCopilotActivePayload(null);
          }
          return;
        }
      }

      // Normal Hamle Takibi
      const clickable = target.closest('button, a, input, select, textarea, [data-action], .upd-card, .kap-item, .st-btn');
      if (clickable) {
        const text = (clickable.getAttribute('data-action') || clickable.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50);
        if (text && text.length > 2 && !text.includes('FRAUDE')) {
          const tagName = clickable.tagName.toLowerCase();
          const actionText = tagName === 'button' ? `Tıklandı: "${text}"` : `İşlem: "${text}"`;
          const ctx = getCopilotContext();
          const last = ctx.recentActions[0]?.action;
          if (last !== actionText) {
            ctx.recentActions = [
              {
                timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                action: actionText,
                module: ctx.activeModule,
              },
              ...ctx.recentActions.slice(0, 7),
            ];
            setContext({ ...ctx });
          }
        }
      }
    };

    window.addEventListener('click', handleGlobalClick, { capture: true });
    return () => window.removeEventListener('click', handleGlobalClick, { capture: true });
  }, []);

  // Pano Yapıştırma (Clipboard Image / Screen Capture Paste)
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            if (typeof evt.target?.result === 'string') {
              setAttachedImage(evt.target.result);
              setIsExpanded(true);
            }
          };
          reader.readAsDataURL(file);
          e.preventDefault();
          break;
        }
      }
    }
  };

  const handleSend = async (customPrompt?: string) => {
    const textToSend = (customPrompt ?? input).trim();
    if ((!textToSend && !attachedImage) || loading) return;

    setIsExpanded(true);

    const userText = attachedImage ? `${textToSend || 'Ekteki görseli/ekran görüntüsünü incele.'} [🖼️ Görsel Eklendi]` : textToSend;

    const userMsg: ChatMsg = {
      id: String(Date.now()),
      sender: 'user',
      text: userText,
      timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customPrompt) setInput('');
    const currentImg = attachedImage;
    setAttachedImage(null);
    setLoading(true);

    try {
      const actionsFormatted = context.recentActions
        .map((a) => `- [${a.timestamp}] [${a.module ?? 'Genel'}] ${a.action} ${a.detail ? `(${a.detail})` : ''}`)
        .join('\n');

      const payloadFormatted = context.activePayload ? JSON.stringify(context.activePayload, null, 2) : 'Yok';

      const fullContextStr = `[CANLI UYGULAMA KULLANICI BAĞLAMI]
Aktif Modül: "${context.activeModule}"
Seçilen AI Modeli: ${selectedModel}
Düşünme / Efor Seviyesi: ${effortLevel.toUpperCase()}
Aktif AI Agent Persona: ${selectedAgent === 'kap_inspector' ? 'Bilanço & KAP Dedektifi' : selectedAgent === 'macro_analyst' ? 'Makroekonomi Araştırmacısı' : 'Borsa & Sektör Analisti'}
Son Kullanıcı Hamleleri:
${actionsFormatted || '- Henüz hamle yapılmadı'}
Aktif Sayfa Verisi:
${payloadFormatted}
${currentImg ? `\n[EK GÖRSEL / EKRAN GÖRÜNTÜSÜ DETAYI]: Kullanıcı panodan görsel yapıştırdı (${currentImg.slice(0, 100)}...)` : ''}

Sen FRAUDE Borsa ve Finans Terminali'nin entegre AI Asistanısın. Soruları belirlenen AI Modeli (${selectedModel}) ve Persona (${selectedAgent}) çerçevesinde yanıtla.`;

      const res = await askAi(
        textToSend || 'Ekteki görseli ve mevcut ekranı analiz et.',
        fullContextStr,
        undefined,
        undefined,
        effortLevel,
      );

      const aiReplyText = res && typeof res.summary === 'string' && res.summary.trim()
        ? res.summary.trim()
        : 'Üzgünüm, şu an yanıt oluşturulamadı. Lütfen Ayarlar sekmesinden geçerli bir AI Key seçildiğinden emin olun.';

      const botMsg: ChatMsg = {
        id: String(Date.now() + 1),
        sender: 'assistant',
        text: aiReplyText,
        timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch {
      const errorMsg: ChatMsg = {
        id: String(Date.now() + 1),
        sender: 'assistant',
        text: '⚠ AI servisine erişilirken bir hata oluştu. Ayarlar sekmesinden varsayılan AI anahtarınızı kontrol edebilirsiniz.',
        timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const showBackdrop = (isExpanded || isHovered) && !isCmdFPressed;

  return (
    <>
      {/* Chatbot Büyüdüğünde Arka Planı Bulanıklaştıran Glassmorphic Overlay (Cmd+F Basılınca Ortadan Kalkar) */}
      {showBackdrop && (
        <div
          className="copilot-backdrop"
          onClick={() => setIsExpanded(false)}
          title="Kapatmak için tıklayın"
        />
      )}

      <div
        className={`copilot-container ${isExpanded ? 'expanded' : 'collapsed'} ${isHovered ? 'hover-wide' : ''}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
      {/* Genişletilmiş Chat & Ayarlar Gövdesi (Sadece Tıklanınca / Mesaj Gönderilince Açılır) */}
      {isExpanded && (
        <div className="copilot-terminal-body">
          <div className="copilot-terminal-header">
            <span className="copilot-brand">⚡ FRAUDE TERMINAL AI {hasAiKey ? '• [CANLI AI BAĞLI]' : ''}</span>
            <button
              type="button"
              className="copilot-minimize-btn"
              onClick={() => {
                setIsExpanded(false);
              }}
              title="Küçült"
            >
              ▾ Küçült
            </button>
          </div>

          {/* 🤖 AI AGENT, MODEL & EFFORT AYAR BARI */}
          <div className="copilot-config-bar">
            <div className="config-group">
              <span className="config-label">🤖 Agent:</span>
              <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}>
                <option value="kap_inspector">⚖️ Bilanço & KAP Dedektifi</option>
                <option value="sector_analyst">📊 Borsa & Sektör Analisti</option>
                <option value="macro_analyst">🌍 Makroekonomi Araştırmacısı</option>
              </select>
            </div>

            <div className="config-group">
              <span className="config-label">🧠 Model:</span>
              <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                <option value="gemini-1.5-flash">Gemini 1.5 Flash (Hızlı)</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro (Derin)</option>
                <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                <option value="gpt-4o">GPT-4o (Omni)</option>
                <option value="deepseek-r1">DeepSeek R1 (Mantık)</option>
              </select>
            </div>

            <div className="config-group">
              <span className="config-label">🔥 Efor:</span>
              <select value={effortLevel} onChange={(e) => setEffortLevel(e.target.value as any)}>
                <option value="low">⚡ Düşük</option>
                <option value="medium">⚖️ Orta</option>
                <option value="high">🧠 Yüksek (Derin)</option>
              </select>
            </div>
          </div>

          {/* 💡 CANLI DAKTİLO İPUÇLARI ÇİP LİSTESİ */}
          <div className="typewriter-prompts-bar">
            <span className="prompts-title">💡 Canlı İpucu Önerileri (Tıkla ve Sor):</span>
            <div className="prompts-chips-wrapper">
              {allPrompts.map((pText, pIdx) => (
                <button
                  key={pIdx}
                  type="button"
                  className="typewriter-chip"
                  onClick={() => {
                    const cleanText = pText.replace(/^[\s\S]*?\]\s*/, '').replace(/\.+$|\:+$/, '');
                    setInput(cleanText);
                  }}
                  title="Bu ipucunu soru kutusuna ekle"
                >
                  {pText}
                </button>
              ))}
            </div>
          </div>

          <div className="copilot-messages">
            {messages.length === 0 ? (
              <div className="copilot-empty-hint">
                ⚡ FRAUDE AI Terminali hazır. Yukarıdaki canlı ipuçlarına tıklayın, yazıp <b>Enter</b>'a basın veya görsel yapıştırın (Cmd+V).
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`copilot-msg-bubble ${m.sender}`}>
                  <span className="msg-prefix">{m.sender === 'user' ? '► SİZ:' : '⚡ FRAUDE:'}</span>
                  <span className="msg-content">{m.text}</span>
                  <span className="msg-time">{m.timestamp}</span>
                </div>
              ))
            )}
            {loading && (
              <div className="copilot-msg-bubble assistant loading">
                <span>⚡ FRAUDE işliyor ({selectedModel} - {effortLevel.toUpperCase()})...</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Quick Action Chips */}
          <div className="copilot-chips">
            <button
              type="button"
              className="chip"
              onClick={() => void handleSend('Şu anki ekran için uygun bir AI agent promptu üret.')}
            >
              ✨ Prompt Üret
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => void handleSend('Ekranda açık olan veriyi ve bilgileri özetle.')}
            >
              📊 Özetle
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => void handleSend('Son işlemimi ve mevcut görünümü finansal olarak analiz et.')}
            >
              ⚡ Analiz Et
            </button>
          </div>
        </div>
      )}

      {/* Tek Satır Capsule / Pill Bar (Fare Gelince Hem Eni Hem Boyu Büyüyen Native Kapsül Bar) */}
      <div className="copilot-single-bar" onPaste={handlePaste}>
        <span className="copilot-bar-brand">⚡ FRAUDE &gt;</span>

        {attachedImage && (
          <span className="copilot-img-tag" onClick={() => setAttachedImage(null)} title="Görseli Kaldır">
            🖼️ Görsel ✕
          </span>
        )}

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          onFocus={() => {
            if (messages.length > 0) setIsExpanded(true);
          }}
          placeholder={attachedImage ? 'Görsel eklendi! Sorunuzu yazıp Enter\'a basın...' : typewriterText}
          disabled={loading}
        />

        {/* Fare İle Üstüne Gelindiğinde Kapsül İçi Bağlı Gerçek AI Key & Efor Seçicileri */}
        {isHovered && (
          <div className="inline-capsule-controls" onClick={(e) => e.stopPropagation()}>
            <select
              value={selectedKeyId}
              onChange={(e) => {
                const keyId = e.target.value;
                setSelectedKeyId(keyId);
                const found = aiKeys.find((k) => k.id === keyId);
                if (found) {
                  setSelectedModel(found.default_model || found.provider);
                }
              }}
              title="Bağlı Gerçek AI Anahtarı ve Modeli"
              className="capsule-select"
            >
              {aiKeys.length === 0 ? (
                <option value="">⚠️ AI Key Ekleyin</option>
              ) : (
                aiKeys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.is_default ? '⭐ ' : ''}{k.label || k.provider} ({k.default_model || 'Genel'})
                  </option>
                ))
              )}
            </select>

            <select
              value={effortLevel}
              onChange={(e) => setEffortLevel(e.target.value as any)}
              title="Düşünme / Efor Seviyesi"
              className="capsule-select"
            >
              <option value="low">⚡ Düşük</option>
              <option value="medium">⚖️ Orta</option>
              <option value="high">🧠 Yüksek</option>
            </select>
          </div>
        )}
      </div>
    </div>
  </>
);
}
