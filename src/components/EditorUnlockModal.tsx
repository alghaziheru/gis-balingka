import { useState, type FormEvent } from 'react';
import { Lock, Unlock, X } from 'lucide-react';
import { useActiveRegion, useT } from '../context/RegionContext';
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
  const region = useActiveRegion();
  const t = useT(lang);

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
      onUnlocked(passphrase, name.trim() || region.authorities.defaultEditorName);
      setPassphrase('');
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
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[430px] rounded-2xl border border-[#161c1a]/15 bg-white p-5 shadow-2xl">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#0369a1]/12 text-[#0369a1]">
              {requiresPassphrase ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
            </div>
            <h2 className="m-0 text-[15.5px] font-bold text-[#161c1a]">{t.editorModalTitle}</h2>
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

        <p className="mb-3.5 text-[13px] leading-relaxed text-[#434d49]">{t.editorModalDesc}</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-[12.5px] font-semibold text-[#434d49]" htmlFor="ed-actor">
              {t.editorActorLabel}
            </label>
            <input
              id="ed-actor"
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="min-h-[40px] w-full rounded-lg border border-[#161c1a]/20 px-3 py-1.5 text-[14px] outline-none focus:border-[#0369a1]"
            />
          </div>

          {requiresPassphrase && (
            <div>
              <label className="mb-1 block text-[12.5px] font-semibold text-[#434d49]" htmlFor="ed-pass">
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
                className="min-h-[40px] w-full rounded-lg border border-[#161c1a]/20 px-3 py-1.5 text-[14px] outline-none focus:border-[#0369a1]"
              />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-[#b91c1c]/25 bg-[#b91c1c]/10 px-3 py-2 text-[12.5px] font-semibold text-[#b91c1c]">
              {error}
            </div>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] rounded-lg border border-[#161c1a]/15 bg-white px-3.5 py-2 text-[13px] font-semibold text-[#434d49] hover:bg-[#f2f3ef]"
            >
              {t.close}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="min-h-[40px] rounded-lg bg-[#0369a1] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#075985] disabled:opacity-60"
            >
              {busy ? '...' : t.editorUnlockBtn}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
