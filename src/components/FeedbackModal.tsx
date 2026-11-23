import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, MessageSquare, X } from 'lucide-react';
import { I18N } from '../i18n/translations';
import type { Language } from '../types/gis';

const GITHUB_ISSUES_URL = 'https://github.com/alghaziheru/gis-balingka/issues/new/choose';

function getSafeExternalUrl(raw: string | undefined): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

interface FeedbackModalProps {
  open: boolean;
  lang: Language;
  apiAvailable: boolean;
  onSubmit: (payload: { name: string; topic: string; message: string }) => Promise<void>;
  onClose: () => void;
}

export function FeedbackModal({ open, lang, apiAvailable, onSubmit, onClose }: FeedbackModalProps) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('feature_idea');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const t = I18N[lang];
  const isEn = lang === 'en';
  const feedbackFormUrl = getSafeExternalUrl(import.meta.env.VITE_FEEDBACK_URL);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        topic,
        message: message.trim()
      });
      setMessage('');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#161c1a]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-modal-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[460px] rounded-2xl border border-[#161c1a]/15 bg-white p-5 shadow-2xl">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#0369a1]/12 text-[#0369a1]">
              <MessageSquare className="h-4 w-4" />
            </div>
            <h2 id="feedback-modal-title" className="m-0 text-[16px] font-extrabold text-[#161c1a]">
              {t.feedbackTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="grid h-8 w-8 place-items-center rounded-lg border border-[#161c1a]/15 text-[#434d49] hover:bg-[#f2f3ef]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-0 mb-3.5 text-[13px] leading-relaxed text-[#434d49]">{t.feedbackSubtitle}</p>

        {!apiAvailable ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-[#0369a1]/20 bg-[#f2f3ef] px-3 py-2.5 text-[12.5px] leading-relaxed text-[#434d49]">
              {feedbackFormUrl ? t.feedbackStaticHint : t.feedbackStaticNoFormHint}
            </div>

            <div className="flex flex-col gap-2">
              {feedbackFormUrl && (
                <a
                  href={feedbackFormUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-[#0369a1] px-4 py-2 text-[13.5px] font-bold text-white no-underline transition hover:bg-[#075985]"
                >
                  <span>{t.feedbackOpenFormBtn}</span>
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}

              <a
                href={GITHUB_ISSUES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-[13px] font-bold no-underline transition ${
                  feedbackFormUrl
                    ? 'border border-[#161c1a]/15 bg-[#fafaf8] text-[#161c1a] hover:bg-[#f2f3ef]'
                    : 'bg-[#0369a1] text-white hover:bg-[#075985]'
                }`}
              >
                <span>{t.feedbackOpenGithubBtn}</span>
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>

            <div className="mt-1 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[40px] rounded-lg border border-[#161c1a]/15 bg-white px-3.5 py-2 text-[13px] font-semibold text-[#434d49] hover:bg-[#f2f3ef]"
              >
                {t.close}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-[12.5px] font-semibold text-[#434d49]" htmlFor="fb-name">
                {isEn ? 'Your name (optional)' : 'Nama Anda (opsional)'}
              </label>
              <input
                id="fb-name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={isEn ? 'e.g. Budi' : 'cth. Budi'}
                className="min-h-[42px] w-full rounded-lg border border-[#161c1a]/20 bg-white px-3 py-2 text-[14px] text-[#161c1a] outline-none focus:border-[#0369a1]"
              />
            </div>

            <div>
              <label className="mb-1 block text-[12.5px] font-semibold text-[#434d49]" htmlFor="fb-topic">
                {isEn ? 'Topic' : 'Topik masukan'}
              </label>
              <select
                id="fb-topic"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                className="min-h-[42px] w-full rounded-lg border border-[#161c1a]/20 bg-white px-2.5 py-2 text-[13.5px] text-[#161c1a]"
              >
                <option value="feature_idea">{isEn ? 'Feature suggestion / UI' : 'Saran fitur / Tampilan'}</option>
                <option value="data_clarity">{isEn ? 'Map data & clarity' : 'Kejelasan data & peta'}</option>
                <option value="bug_report">{isEn ? 'Technical issue' : 'Kendala teknis'}</option>
                <option value="general">{isEn ? 'General feedback' : 'Umum / Lainnya'}</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[12.5px] font-semibold text-[#434d49]" htmlFor="fb-msg">
                {isEn ? 'Message' : 'Pesan'}
              </label>
              <textarea
                id="fb-msg"
                required
                rows={4}
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder={
                  isEn
                    ? 'Share your thoughts on usability, clarity, or features you would like to see...'
                    : 'Tuliskan saran, masukan tampilan, atau fitur yang ingin Anda lihat di aplikasi ini...'
                }
                className="w-full rounded-lg border border-[#161c1a]/20 bg-white px-3 py-2 text-[14px] text-[#161c1a] outline-none focus:border-[#0369a1]"
              />
            </div>

            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] rounded-lg border border-[#161c1a]/15 bg-white px-3.5 py-2 text-[13px] font-semibold text-[#434d49] hover:bg-[#f2f3ef]"
              >
                {t.close}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="min-h-[42px] rounded-lg bg-[#0369a1] px-4 py-2 text-[13.5px] font-bold text-white transition hover:bg-[#075985] disabled:opacity-50"
              >
                {busy ? '...' : t.feedbackSubmitBtn}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
