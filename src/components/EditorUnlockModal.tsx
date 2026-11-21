import { useState, type FormEvent } from 'react';
import { Lock, Unlock, X } from 'lucide-react';
import { I18N } from '../i18n/translations';
import { verifyEditorPassphrase } from '../lib/api';
import type { Language } from '../types/gis';

interface EditorUnlockModalProps {
  open: boolean;
  lang: Language;
  requiresPassphrase: boolean;
  actorName: string;
  onClose: () => void;
  onUnlocked: (passphrase: string, actorName: string) => void;
}

export function EditorUnlockModal({
  open,
  lang,
  requiresPassphrase,
  actorName,
  onClose,
  onUnlocked
}: EditorUnlockModalProps) {
  const [passphrase, setPassphrase] = useState('');
  const [name, setName] = useState(actorName);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;
  const t = I18N[lang];

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (requiresPassphrase) {
        const ok = await verifyEditorPassphrase(passphrase);
        if (!ok) {
          setError(t.editorUnlockError);
          setBusy(false);
          return;
        }
      }
      onUnlocked(passphrase, name.trim() || 'Editor Balingka');
      setPassphrase('');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a1410]/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[420px] rounded-[16px] border border-[#12231c]/15 bg-white p-5 shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#0284c7]/12 text-[#0369a1]">
              {requiresPassphrase ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
            </div>
            <h2 className="m-0 text-[15px] font-extrabold text-[#12231c]">{t.editorModalTitle}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="grid h-7 w-7 place-items-center rounded-lg border border-[#12231c]/15 text-[#3f524a] hover:bg-[#eff4f1]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-xs leading-relaxed text-[#3f524a]">{t.editorModalDesc}</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
          <div>
            <label className="mb-1 block text-[11px] font-bold text-[#3f524a]" htmlFor="ed-actor">
              {t.editorActorLabel}
            </label>
            <input
              id="ed-actor"
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full rounded-lg border border-[#12231c]/20 px-2.5 py-1.5 text-xs outline-none focus:border-[#0284c7]"
            />
          </div>

          {requiresPassphrase && (
            <div>
              <label className="mb-1 block text-[11px] font-bold text-[#3f524a]" htmlFor="ed-pass">
                {t.editorPassLabel}
              </label>
              <input
                id="ed-pass"
                type="password"
                required
                autoFocus
                value={passphrase}
                onChange={e => setPassphrase(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-[#12231c]/20 px-2.5 py-1.5 text-xs outline-none focus:border-[#0284c7]"
              />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-[#dc2626]/25 bg-[#dc2626]/10 px-2.5 py-1.5 text-xs font-semibold text-[#991b1b]">
              {error}
            </div>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#12231c]/15 bg-white px-3 py-1.5 text-xs font-bold text-[#3f524a] hover:bg-[#eff4f1]"
            >
              {t.close}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg border border-[#0369a1] bg-[#0284c7] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#0369a1] disabled:opacity-60"
            >
              {busy ? '...' : t.editorUnlockBtn}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
