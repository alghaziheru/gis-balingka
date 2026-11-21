import { useState, type FormEvent } from 'react';
import { CheckCircle2, Crosshair, MapPin, MessageSquarePlus } from 'lucide-react';
import { I18N } from '../i18n/translations';
import type { CitizenSuggestion, Language, SuggestionStatus } from '../types/gis';

interface SuggestionBoxPanelProps {
  lang: Language;
  suggestions: CitizenSuggestion[];
  apiAvailable: boolean;
  editorUnlocked: boolean;
  suggestionPin: [number, number] | null;
  isPickingPin: boolean;
  onTogglePickPin: () => void;
  onClearPin: () => void;
  onSubmitSuggestion: (payload: {
    reporter_name: string;
    contact: string;
    category: string;
    location_name: string;
    message: string;
    lng: number | null;
    lat: number | null;
  }) => Promise<void>;
  onUpdateStatus: (id: number, status: SuggestionStatus, resolution_note: string) => Promise<void>;
  onFlyToPin: (coords: [number, number]) => void;
}

const STATUS_BADGE: Record<SuggestionStatus, string> = {
  open: 'bg-[#d97706]/14 text-[#92400e]',
  reviewing: 'bg-[#0284c7]/14 text-[#0369a1]',
  resolved: 'bg-[#059669]/12 text-[#065f46]',
  rejected: 'bg-[#64748b]/14 text-[#334155]'
};

export function SuggestionBoxPanel({
  lang,
  suggestions,
  apiAvailable,
  editorUnlocked,
  suggestionPin,
  isPickingPin,
  onTogglePickPin,
  onClearPin,
  onSubmitSuggestion,
  onUpdateStatus,
  onFlyToPin
}: SuggestionBoxPanelProps) {
  const t = I18N[lang];
  const isEn = lang === 'en';
  const [reporterName, setReporterName] = useState('');
  const [contact, setContact] = useState('');
  const [category, setCategory] = useState('waterway_correction');
  const [locationName, setLocationName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reporterName.trim() || !message.trim()) return;
    setBusy(true);
    try {
      await onSubmitSuggestion({
        reporter_name: reporterName.trim(),
        contact: contact.trim(),
        category,
        location_name: locationName.trim() || 'Nagari Balingka',
        message: message.trim(),
        lng: suggestionPin ? suggestionPin[0] : null,
        lat: suggestionPin ? suggestionPin[1] : null
      });
      setMessage('');
      setLocationName('');
      onClearPin();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[11px] border border-[#12231c]/12 bg-white p-3 shadow-xs">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-extrabold tracking-wider text-[#64776f] uppercase">
          <MessageSquarePlus className="h-3.5 w-3.5 text-[#0284c7]" />
          <span>{t.suggestTitle}</span>
        </div>
        <p className="mb-2.5 text-[11.5px] leading-relaxed text-[#3f524a]">{t.suggestSubtitle}</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-bold text-[#3f524a]" htmlFor="sug-name">
                {isEn ? 'Your Name' : 'Nama Warga'}
              </label>
              <input
                id="sug-name"
                type="text"
                required
                value={reporterName}
                onChange={e => setReporterName(e.target.value)}
                placeholder={isEn ? 'e.g. Pak Rijal' : 'cth. Pak Rijal'}
                className="w-full rounded-lg border border-[#12231c]/20 px-2.5 py-1.5 text-xs outline-none focus:border-[#0284c7]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold text-[#3f524a]" htmlFor="sug-contact">
                {isEn ? 'Contact (Optional)' : 'WA / Kontak (Opsional)'}
              </label>
              <input
                id="sug-contact"
                type="text"
                value={contact}
                onChange={e => setContact(e.target.value)}
                placeholder="08xx / IG"
                className="w-full rounded-lg border border-[#12231c]/20 px-2.5 py-1.5 text-xs outline-none focus:border-[#0284c7]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-bold text-[#3f524a]" htmlFor="sug-cat">
                {isEn ? 'Topic' : 'Kategori'}
              </label>
              <select
                id="sug-cat"
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full rounded-lg border border-[#12231c]/20 bg-white px-2 py-1.5 text-xs"
              >
                <option value="waterway_correction">{isEn ? 'Stream Misalignment' : 'Koreksi Jalur Sungai'}</option>
                <option value="unmapped_drain">{isEn ? 'Unmapped Drain / Ditch' : 'Bandar Belum Terpetakan'}</option>
                <option value="clogged_culvert">{isEn ? 'Clogged Culvert' : 'Gorong-gorong Tersumbat'}</option>
                <option value="flood_history">{isEn ? 'Flood Mark 2025' : 'Titik Banjir Nov 2025'}</option>
                <option value="other">{isEn ? 'Other' : 'Lainnya'}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold text-[#3f524a]" htmlFor="sug-loc">
                {isEn ? 'Jorong / Landmark' : 'Jorong / Patokan'}
              </label>
              <input
                id="sug-loc"
                type="text"
                value={locationName}
                onChange={e => setLocationName(e.target.value)}
                placeholder="cth. Simpang Batang Ngalai"
                className="w-full rounded-lg border border-[#12231c]/20 px-2.5 py-1.5 text-xs outline-none focus:border-[#0284c7]"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={onTogglePickPin}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${
              isPickingPin
                ? 'border-[#0369a1] bg-[#0284c7] text-white'
                : 'border-[#12231c]/15 bg-white text-[#12231c] hover:bg-[#eff4f1]'
            }`}
          >
            <MapPin className="h-3.5 w-3.5" />
            <span>
              {suggestionPin
                ? `${t.suggestPickPinBtn}: ${suggestionPin[1].toFixed(4)}, ${suggestionPin[0].toFixed(4)}`
                : t.suggestPickPinBtn}
            </span>
          </button>

          <div>
            <label className="mb-1 block text-[11px] font-bold text-[#3f524a]" htmlFor="sug-msg">
              {isEn ? 'Description / Suggested Correction' : 'Uraian Masukan / Koreksi'}
            </label>
            <textarea
              id="sug-msg"
              required
              rows={3}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={
                isEn
                  ? 'Describe where the stream actually bends or where a ditch is missing...'
                  : 'Jelaskan posisi sungai sebenarnya, belokan bandar sawah, atau gorong yang perlu dicek...'
              }
              className="w-full rounded-lg border border-[#12231c]/20 px-2.5 py-1.5 text-xs outline-none focus:border-[#0284c7]"
            />
          </div>

          <button
            type="submit"
            disabled={busy || !apiAvailable}
            className="rounded-lg border border-[#0369a1] bg-[#0284c7] py-2 text-xs font-bold text-white hover:bg-[#0369a1] disabled:opacity-50"
          >
            {busy ? '...' : t.suggestSubmitBtn}
          </button>
        </form>
      </div>

      <div className="rounded-[11px] border border-[#12231c]/12 bg-white p-3 shadow-xs">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-extrabold tracking-wider text-[#64776f] uppercase">
            {t.suggestListTitle}
          </span>
          <span className="font-mono-num rounded-full border border-[#12231c]/12 bg-[#eff4f1] px-2 py-0.5 text-[11px] font-bold">
            {suggestions.length}
          </span>
        </div>

        {suggestions.length === 0 ? (
          <p className="m-0 py-3 text-center text-xs text-[#64776f]">
            {isEn ? 'No citizen suggestions yet.' : 'Belum ada saran masuk.'}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {suggestions.map(s => (
              <div key={s.id} className="rounded-lg border border-[#12231c]/12 bg-[#f8faf9] p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <strong className="text-xs text-[#12231c]">{s.location_name}</strong>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase ${
                          STATUS_BADGE[s.status] || STATUS_BADGE.open
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-[#64776f]">
                      {s.reporter_name} · {new Date(s.created_at).toLocaleDateString(isEn ? 'en-GB' : 'id-ID')}
                    </div>
                  </div>
                  {s.lng !== null && s.lat !== null && (
                    <button
                      type="button"
                      onClick={() => onFlyToPin([s.lng!, s.lat!])}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded border border-[#12231c]/15 bg-white text-[#3f524a] hover:bg-[#eff4f1]"
                      title={t.viewMap}
                    >
                      <Crosshair className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <p className="mt-1.5 mb-0 text-[11.5px] text-[#12231c]">{s.message}</p>
                {s.resolution_note && (
                  <div className="mt-1.5 rounded bg-[#059669]/10 px-2 py-1 text-[11px] font-semibold text-[#065f46]">
                    Editor: {s.resolution_note}
                  </div>
                )}
                {editorUnlocked && apiAvailable && s.status !== 'resolved' && (
                  <div className="mt-2 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateStatus(
                          s.id,
                          'resolved',
                          isEn ? 'Verified and applied to map.' : 'Diverifikasi & diterapkan di peta.'
                        )
                      }
                      className="inline-flex items-center gap-1 rounded border border-[#059669]/30 bg-white px-2 py-0.5 text-[10.5px] font-bold text-[#065f46] hover:bg-[#059669]/10"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      <span>{isEn ? 'Mark Resolved' : 'Tandai Selesai'}</span>
                    </button>
                    {s.status === 'open' && (
                      <button
                        type="button"
                        onClick={() => onUpdateStatus(s.id, 'reviewing', '')}
                        className="rounded border border-[#12231c]/15 bg-white px-2 py-0.5 text-[10.5px] font-bold text-[#3f524a] hover:bg-[#eff4f1]"
                      >
                        {isEn ? 'Review' : 'Tinjau'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
