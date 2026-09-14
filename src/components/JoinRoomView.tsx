import React, { useState } from 'react';
import { LogIn, ArrowLeft, AlertCircle, Loader2, KeyRound, User } from 'lucide-react';
import { formatRoomCode, validatePlayerName } from '../utils/session';

interface JoinRoomViewProps {
  initialPlayerName: string;
  onJoin: (roomCode: string, displayName: string) => Promise<{ success: boolean; error?: string }>;
  onBack: () => void;
}

export const JoinRoomView: React.FC<JoinRoomViewProps> = ({
  initialPlayerName,
  onJoin,
  onBack,
}) => {
  const [roomCode, setRoomCode] = useState('');
  const [displayName, setDisplayName] = useState(initialPlayerName);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const formattedCode = formatRoomCode(roomCode);
    if (!formattedCode || formattedCode.length < 4) {
      setErrorMessage('Please enter a valid room code (at least 4 characters).');
      return;
    }

    const nameVal = validatePlayerName(displayName);
    if (!nameVal.valid) {
      setErrorMessage(nameVal.error || 'Please enter a valid display name.');
      return;
    }

    setIsLoading(true);
    const res = await onJoin(formattedCode, displayName.trim());
    setIsLoading(false);

    if (!res.success) {
      setErrorMessage(res.error || 'Unable to join room. Please check code and try again.');
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto px-4 py-6 sm:py-8 flex flex-col items-center">
      {/* Back button */}
      <div className="w-full mb-4 sm:mb-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neutral-400 hover:text-white transition-colors cursor-pointer"
          style={{ fontFamily: "'Chakra Petch', sans-serif" }}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Menu</span>
        </button>
      </div>

      <div className="w-full bg-black border border-neutral-800 p-6 sm:p-8 relative">
        <div className="text-center mb-6">
          <h2
            className="font-glitch text-2xl sm:text-3xl text-white uppercase tracking-wider"
            style={{
              fontFamily: "'Doctor Glitch', 'Rubik Glitch', sans-serif",
              letterSpacing: '0.04em',
            }}
          >
            <span className="text-white">ENTER </span>
            <span className="text-[#FA5A00]">ROOM</span>
          </h2>
          <p
            className="text-xs text-neutral-400 mt-2 uppercase tracking-wider font-medium"
            style={{ fontFamily: "'Outfit', sans-serif" }}
          >
            Join an existing 1v1 debate arena as Player B (Challenger)
          </p>
        </div>

        {/* Error notification banner */}
        {errorMessage && (
          <div className="mb-5 p-3 bg-black border border-red-800 flex items-start gap-2.5 text-red-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium">{errorMessage}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Room code input box - Page 2 Chamfered style */}
          <div>
            <label
              className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5 flex items-center gap-1.5 font-semibold"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              <KeyRound className="w-3.5 h-3.5 text-[#FA5A00]" />
              <span>Room Code:</span>
            </label>
            <div className="h-[46px] relative flex items-center">
              <input
                type="text"
                autoFocus
                maxLength={6}
                data-max-sound="6"
                value={roomCode}
                onChange={(e) => {
                  setRoomCode(formatRoomCode(e.target.value));
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="FZ9482"
                className="w-full h-full px-4 bg-black border border-[#FA5A00]/60 focus:border-[#FA5A00] text-white placeholder:text-neutral-600 focus:outline-none text-base sm:text-lg tracking-widest text-center uppercase font-mono font-bold transition-colors"
              />
            </div>
          </div>

          {/* Codename input box - Page 2 style */}
          <div>
            <label
              className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5 flex items-center gap-1.5 font-semibold"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              <User className="w-3.5 h-3.5 text-[#FA5A00]" />
              <span>Your Codename:</span>
            </label>
            <div className="h-[46px] relative flex items-center">
              <input
                type="text"
                maxLength={18}
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="cipher"
                className="w-full h-full px-4 bg-black border border-neutral-800 focus:border-[#FA5A00] text-white placeholder:text-neutral-600 focus:outline-none text-sm font-mono font-bold transition-colors"
              />
            </div>
            <p className="mt-1 text-[11px] text-neutral-400" style={{ fontFamily: "'Outfit', sans-serif" }}>
              Temporary codename for this match only.
            </p>
          </div>

          {/* Submit button - Cybernetic Orange Solid Button matching Page 2 */}
          <button
            type="submit"
            disabled={isLoading || !roomCode.trim()}
            className="w-full mt-4 h-[52px] bg-[#FA5A00] hover:brightness-105 active:scale-[0.99] text-black text-base tracking-wider uppercase flex items-center justify-center gap-2.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            style={{
              fontFamily: "'Chakra Petch', 'Outfit', sans-serif",
              fontWeight: 800,
            }}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-black" />
                <span>Checking Room...</span>
              </>
            ) : (
              <>
                <LogIn className="w-5 h-5 text-black stroke-[2.5]" />
                <span>ENTER ROOM</span>
              </>
            )}
          </button>
        </form>

        <div
          className="mt-5 text-center text-[11px] text-neutral-400 uppercase tracking-wider"
          style={{ fontFamily: "'Chakra Petch', sans-serif" }}
        >
          Rooms strictly enforce maximum 2 debaters per match
        </div>
      </div>
    </div>
  );
};

