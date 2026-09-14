import React, { useState } from 'react';
import { Match, MatchPlayer } from '../types/game';
import { Copy, Check, ArrowLeft, Shield, Loader2 } from 'lucide-react';

interface CreateRoomViewProps {
  match: Match;
  player: MatchPlayer;
  isRealtimeActive: boolean;
  onCancel: () => void;
}

export const CreateRoomView: React.FC<CreateRoomViewProps> = ({
  match,
  player,
  isRealtimeActive,
  onCancel,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(match.room_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = match.room_code;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-6 sm:py-8 flex flex-col items-center">
      {/* Back button */}
      <div className="w-full mb-4 sm:mb-6">
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neutral-400 hover:text-white transition-colors cursor-pointer"
          style={{ fontFamily: "'Chakra Petch', sans-serif" }}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Cancel & Leave Room</span>
        </button>
      </div>

      {/* Main Room Card - Flat Black with Sharp Border */}
      <div className="w-full bg-black border border-neutral-800 p-6 sm:p-8 relative">
        {/* Room Header */}
        <div className="text-center mb-6">
          <div
            className="inline-flex items-center gap-2 px-2.5 py-1 bg-black border border-[#FA5A00]/40 text-[10px] font-bold text-[#FA5A00] uppercase tracking-widest mb-3"
            style={{ fontFamily: "'Chakra Petch', sans-serif" }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#FA5A00]" />
            <span>Room Active — Waiting for Challenger</span>
          </div>
          <h2
            className="font-glitch text-2xl sm:text-3xl text-white uppercase tracking-wider"
            style={{
              fontFamily: "'Doctor Glitch', 'Rubik Glitch', sans-serif",
              letterSpacing: '0.04em',
            }}
          >
            <span className="text-white">ROOM </span>
            <span className="text-[#FA5A00]">CODE</span>
          </h2>
          <p
            className="text-xs text-neutral-400 mt-2 uppercase tracking-wider font-medium"
            style={{ fontFamily: "'Outfit', sans-serif" }}
          >
            Share this 6-character battle code with your opponent
          </p>
        </div>

        {/* Big Room Code Box - Chamfered Style */}
        <div className="bg-black border border-[#FA5A00]/40 p-5 sm:p-6 text-center mb-6 relative">
          <div
            className="text-3xl sm:text-5xl font-black tracking-[0.12em] sm:tracking-[0.2em] text-[#FA5A00] select-all uppercase break-all"
            style={{
              fontFamily: "'Doctor Glitch', 'Rubik Glitch', monospace",
              letterSpacing: '0.14em',
            }}
          >
            {match.room_code}
          </div>

          <div className="mt-4 flex items-center justify-center">
            <button
              onClick={handleCopyCode}
              className={`inline-flex items-center gap-2 px-5 py-2 text-xs uppercase tracking-wider transition-colors cursor-pointer ${
                copied
                  ? 'bg-[#FA5A00] text-black font-extrabold'
                  : 'bg-black text-white hover:text-[#FA5A00] border border-[#FA5A00]/60 hover:border-[#FA5A00]'
              }`}
              style={{
                fontFamily: "'Chakra Petch', sans-serif",
                fontWeight: 700,
              }}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Code</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 2-Player Slots Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-6">
          {/* Player A Slot (Creator) */}
          <div className="p-4 bg-black border border-neutral-800">
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-[9px] font-bold uppercase tracking-widest text-[#FA5A00] px-1.5 py-0.5 border border-[#FA5A00]/30"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                Player A (Host)
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>
            <div
              className="text-base sm:text-lg text-white font-bold truncate"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              {player.display_name}
            </div>
            <div className="text-[11px] text-neutral-400 mt-1 flex items-center gap-1">
              <Shield className="w-3 h-3 text-[#FA5A00]" />
              <span>Side revealed when opponent joins</span>
            </div>
          </div>

          {/* Player B Slot (Waiting for Opponent) */}
          <div className="p-4 bg-black border border-neutral-800 border-dashed flex flex-col justify-center">
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-[9px] font-bold uppercase tracking-widest text-neutral-400 px-1.5 py-0.5 border border-neutral-800"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                Player B (Challenger)
              </span>
              <span className="w-2 h-2 rounded-full bg-neutral-600" />
            </div>
            <div
              className="flex items-center gap-2 text-neutral-400 text-sm font-semibold"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FA5A00] shrink-0" />
              <span>Waiting for opponent...</span>
            </div>
            <div className="text-[11px] text-neutral-400 mt-1">
              Enter code in "Join Room"
            </div>
          </div>
        </div>

        {/* Live sync footer */}
        <div
          className="flex items-center justify-between text-[11px] text-neutral-400 pt-3 border-t border-neutral-800"
          style={{ fontFamily: "'Chakra Petch', sans-serif" }}
        >
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>
              {isRealtimeActive ? 'Realtime Connected' : 'Sync Active'}
            </span>
          </div>
          <span className="text-neutral-400">1v1 Max Cap</span>
        </div>
      </div>
    </div>
  );
};

