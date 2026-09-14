import React, { useState } from 'react';
import { User, X, ArrowRight, ShieldCheck } from 'lucide-react';
import { validatePlayerName } from '../utils/session';

interface PlayerIdentityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
  actionType: 'create' | 'join';
  initialName?: string;
}

export const PlayerIdentityModal: React.FC<PlayerIdentityModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  actionType,
  initialName = '',
}) => {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validatePlayerName(name);
    if (!validation.valid) {
      setError(validation.error || 'Please enter a valid display name.');
      return;
    }
    setError(null);
    onSubmit(name.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 select-none overflow-y-auto">
      <div className="bg-black border border-neutral-800 w-full max-w-md max-h-[90vh] overflow-y-auto p-6 relative my-auto">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-neutral-400 hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 bg-black border border-[#FA5A00]/50 flex items-center justify-center text-[#FA5A00]">
            <User className="w-5 h-5" />
          </div>
          <div>
            <h2
              className="text-lg font-bold text-white uppercase tracking-wider"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              {actionType === 'create' ? 'Host Match' : 'Join Match'}
            </h2>
            <p className="text-xs text-neutral-400" style={{ fontFamily: "'Outfit', sans-serif" }}>
              Enter your temporary battle codename
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              className="block text-xs font-bold uppercase tracking-wider text-neutral-400 mb-1.5"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              Codename:
            </label>
            <input
              type="text"
              autoFocus
              maxLength={18}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="cipher"
              className="w-full px-4 py-2.5 bg-black border border-neutral-800 focus:border-[#FA5A00] text-white placeholder:text-neutral-600 focus:outline-none font-mono font-bold text-sm tracking-wide transition-colors"
            />
            {error ? (
              <p className="mt-1.5 text-xs text-red-400 font-medium">{error}</p>
            ) : (
              <p className="mt-1.5 text-[11px] text-neutral-400" style={{ fontFamily: "'Outfit', sans-serif" }}>
                2 to 18 characters. Ephemeral — discarded after this match completes.
              </p>
            )}
          </div>

          {/* Ephemeral Notice */}
          <div className="flex items-start gap-2.5 p-3 bg-black border border-neutral-800 text-xs text-neutral-400">
            <ShieldCheck className="w-4 h-4 text-[#FA5A00] shrink-0 mt-0.5" />
            <span style={{ fontFamily: "'Outfit', sans-serif" }}>
              Zero signups or stored profiles. Your codename only identifies you during this debate.
            </span>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 bg-black border border-neutral-800 hover:border-neutral-700 text-neutral-300 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 px-4 bg-[#FA5A00] hover:brightness-105 active:scale-[0.99] text-black text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              <span>Continue</span>
              <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

