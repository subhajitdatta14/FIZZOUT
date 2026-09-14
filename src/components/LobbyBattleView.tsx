import React, { useState } from 'react';
import { Match, MatchPlayer } from '../types/game';
import {
  Swords,
  Shield,
  Eye,
  Play,
  Copy,
  Check,
  CheckCircle2,
  Clock,
  Scale,
  Users
} from 'lucide-react';

interface LobbyBattleViewProps {
  match: Match;
  players: MatchPlayer[];
  currentPlayer: MatchPlayer;
  opponentPlayer: MatchPlayer | null;
  onRevealSide: () => Promise<void>;
  onStartGame: () => Promise<void>;
  onLeaveRoom: () => void;
  isRealtimeActive: boolean;
}

export const LobbyBattleView: React.FC<LobbyBattleViewProps> = ({
  match,
  players,
  currentPlayer,
  opponentPlayer,
  onRevealSide,
  onStartGame,
  onLeaveRoom,
  isRealtimeActive,
}) => {
  const [copied, setCopied] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const bothRevealed = Boolean(
    currentPlayer.has_revealed_side && opponentPlayer?.has_revealed_side
  );

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(match.room_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRevealClick = async () => {
    if (currentPlayer.has_revealed_side || isRevealing) return;
    setIsRevealing(true);
    await onRevealSide();
    setIsRevealing(false);
  };

  const handleStartGameClick = async () => {
    if (!bothRevealed || isStarting) return;
    setIsStarting(true);
    await onStartGame();
    setIsStarting(false);
  };

  const playerA = players.find((p) => p.player_slot === 'A');
  const playerB = players.find((p) => p.player_slot === 'B');

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-4 sm:py-6 flex flex-col items-center select-none">
      {/* Top Bar: Room Code & Status */}
      <div className="w-full flex flex-wrap items-center justify-between gap-3 mb-4 bg-black border border-neutral-800 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span
            className="text-xs text-neutral-400 uppercase tracking-wider font-semibold"
            style={{ fontFamily: "'Chakra Petch', sans-serif" }}
          >
            Room:
          </span>
          <span
            className="text-base font-bold tracking-widest text-[#FA5A00] font-mono"
          >
            {match.room_code}
          </span>
          <button
            onClick={handleCopyCode}
            className="p-1 text-neutral-400 hover:text-[#FA5A00] transition-colors cursor-pointer"
            title="Copy Room Code"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        <div
          className="flex items-center gap-2 text-xs font-semibold"
          style={{ fontFamily: "'Chakra Petch', sans-serif" }}
        >
          <span className="px-2 py-0.5 bg-black text-emerald-400 border border-emerald-800 flex items-center gap-1.5 text-[11px] uppercase">
            <Users className="w-3 h-3" />
            <span>2/2 Debaters Ready</span>
          </span>
          <span className="px-2 py-0.5 bg-black text-neutral-300 border border-neutral-800 text-[11px] uppercase">
            {bothRevealed ? 'Stances Locked' : 'Reveal Stance'}
          </span>
        </div>
      </div>

      {/* VS Head-to-Head Banner */}
      <div className="w-full bg-black border border-neutral-800 p-4 sm:p-6 mb-4 sm:mb-6">
        {/* Players Roster */}
        <div className="grid grid-cols-1 md:grid-cols-5 items-center gap-3 text-center">
          {/* Player A */}
          <div className="md:col-span-2 p-3.5 bg-black border border-neutral-800 flex flex-col items-center">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-[9px] font-bold uppercase tracking-widest text-[#FA5A00] px-1.5 py-0.5 border border-[#FA5A00]/30"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                Player A (Host)
              </span>
              {playerA?.player_id === currentPlayer.player_id && (
                <span
                  className="text-[9px] font-bold uppercase tracking-widest text-neutral-300 px-1.5 py-0.5 bg-neutral-900 border border-neutral-700"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  YOU
                </span>
              )}
            </div>
            <div
              className="text-base sm:text-lg text-white font-bold truncate max-w-full"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              {playerA?.display_name || 'Player A'}
            </div>
            <div className="mt-1.5 text-[11px] text-neutral-400 flex items-center gap-1">
              {playerA?.has_revealed_side ? (
                <span className="text-emerald-400 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3 h-3" /> Stance Revealed
                </span>
              ) : (
                <span className="text-[#FA5A00] flex items-center gap-1 font-medium">
                  <Clock className="w-3 h-3" /> Awaiting Reveal
                </span>
              )}
            </div>
          </div>

          {/* VS Center Badge */}
          <div className="md:col-span-1 flex flex-col items-center justify-center my-1 md:my-0">
            <div
              className="w-10 h-10 bg-[#FA5A00] flex items-center justify-center text-black text-sm select-none"
              style={{
                fontFamily: "'Doctor Glitch', 'Rubik Glitch', sans-serif",
                fontWeight: 900,
              }}
            >
              VS
            </div>
          </div>

          {/* Player B */}
          <div className="md:col-span-2 p-3.5 bg-black border border-neutral-800 flex flex-col items-center">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-[9px] font-bold uppercase tracking-widest text-[#FA5A00] px-1.5 py-0.5 border border-[#FA5A00]/30"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                Player B (Challenger)
              </span>
              {playerB?.player_id === currentPlayer.player_id && (
                <span
                  className="text-[9px] font-bold uppercase tracking-widest text-neutral-300 px-1.5 py-0.5 bg-neutral-900 border border-neutral-700"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  YOU
                </span>
              )}
            </div>
            <div
              className="text-base sm:text-lg text-white font-bold truncate max-w-full"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              {playerB?.display_name || 'Player B'}
            </div>
            <div className="mt-1.5 text-[11px] text-neutral-400 flex items-center gap-1">
              {playerB?.has_revealed_side ? (
                <span className="text-emerald-400 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3 h-3" /> Stance Revealed
                </span>
              ) : (
                <span className="text-[#FA5A00] flex items-center gap-1 font-medium">
                  <Clock className="w-3 h-3" /> Awaiting Reveal
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Debate Topic Preview Banner */}
      {match.topic ? (
        <div className="w-full bg-black border border-neutral-800 p-4 mb-4 sm:mb-6 text-center">
          <div
            className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#FA5A00] mb-1.5"
            style={{ fontFamily: "'Chakra Petch', sans-serif" }}
          >
            <Scale className="w-3.5 h-3.5" />
            <span>Debate Topic</span>
          </div>
          <p
            className="text-base sm:text-lg text-white max-w-2xl mx-auto leading-snug font-medium"
            style={{ fontFamily: "'Outfit', sans-serif" }}
          >
            "{match.topic}"
          </p>
        </div>
      ) : null}

      {/* Interactive Stance Cards Grid */}
      <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {/* Card 1: Your Side */}
        <div className="flex flex-col items-center">
          <div
            className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-2 flex items-center gap-1.5"
            style={{ fontFamily: "'Chakra Petch', sans-serif" }}
          >
            <span>Your Stance (Private Card)</span>
          </div>

          {!currentPlayer.has_revealed_side ? (
            /* Unrevealed Hidden Card */
            <button
              onClick={handleRevealClick}
              disabled={isRevealing}
              className="w-full h-56 bg-black border border-[#FA5A00] p-5 flex flex-col items-center justify-center text-center cursor-pointer transition-colors hover:bg-[#FA5A00]/5 active:scale-[0.99] relative group"
            >
              <div
                className="w-12 h-12 bg-black border border-[#FA5A00] flex items-center justify-center text-[#FA5A00] text-2xl font-bold mb-3"
                style={{ fontFamily: "'Doctor Glitch', 'Rubik Glitch', sans-serif" }}
              >
                ?
              </div>
              <div
                className="text-base sm:text-lg text-white uppercase tracking-wider mb-1 font-bold"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                {isRevealing ? 'Revealing...' : 'TAP TO REVEAL STANCE'}
              </div>
              <p
                className="text-[11px] text-neutral-400 max-w-[200px]"
                style={{ fontFamily: "'Outfit', sans-serif" }}
              >
                Only you can reveal your assigned debate position.
              </p>
              <div
                className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold text-[#FA5A00] uppercase tracking-widest"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                <Eye className="w-3 h-3" />
                <span>Reveal Stance</span>
              </div>
            </button>
          ) : (
            /* Revealed Card */
            <div
              className={`w-full h-56 p-5 flex flex-col items-center justify-center text-center border bg-black ${
                currentPlayer.assigned_side === 'FOR'
                  ? 'border-emerald-500'
                  : 'border-red-500'
              }`}
            >
              <div
                className={`w-12 h-12 flex items-center justify-center mb-2 border ${
                  currentPlayer.assigned_side === 'FOR'
                    ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500'
                    : 'bg-red-950/40 text-red-400 border-red-500'
                }`}
              >
                {currentPlayer.assigned_side === 'FOR' ? (
                  <Shield className="w-6 h-6 stroke-[2.5]" />
                ) : (
                  <Swords className="w-6 h-6 stroke-[2.5]" />
                )}
              </div>

              <span
                className={`text-[9px] font-extrabold uppercase tracking-widest px-2 py-0.5 border mb-1.5 ${
                  currentPlayer.assigned_side === 'FOR'
                    ? 'text-emerald-400 border-emerald-500/40 bg-black'
                    : 'text-red-400 border-red-500/40 bg-black'
                }`}
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                Your Assigned Stance
              </span>

              <div
                className={`text-xl sm:text-2xl tracking-wider uppercase mb-1 font-bold ${
                  currentPlayer.assigned_side === 'FOR' ? 'text-emerald-400' : 'text-red-400'
                }`}
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                {currentPlayer.assigned_side === 'FOR' ? 'FOR (AFFIRMATIVE)' : 'AGAINST (NEGATIVE)'}
              </div>

              <p
                className="text-[11px] text-neutral-300 max-w-[240px]"
                style={{ fontFamily: "'Outfit', sans-serif" }}
              >
                {currentPlayer.assigned_side === 'FOR'
                  ? 'Defend the statement and argue in favor of the resolution.'
                  : 'Refute the statement and argue in opposition to the resolution.'}
              </p>
            </div>
          )}
        </div>

        {/* Card 2: Opponent's Side */}
        <div className="flex flex-col items-center">
          <div
            className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-2 flex items-center gap-1.5"
            style={{ fontFamily: "'Chakra Petch', sans-serif" }}
          >
            <span>Opponent's Stance</span>
          </div>

          {!opponentPlayer?.has_revealed_side ? (
            /* Opponent Still Hidden */
            <div className="w-full h-56 bg-black border border-neutral-800 p-5 flex flex-col items-center justify-center text-center">
              <div
                className="w-12 h-12 bg-black border border-neutral-800 flex items-center justify-center text-neutral-600 text-2xl font-bold mb-3"
                style={{ fontFamily: "'Doctor Glitch', 'Rubik Glitch', sans-serif" }}
              >
                ?
              </div>
              <div
                className="text-sm sm:text-base text-neutral-300 uppercase tracking-wide mb-1 font-bold"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                Hidden by Opponent
              </div>
              <p
                className="text-[11px] text-neutral-400 max-w-[200px]"
                style={{ fontFamily: "'Outfit', sans-serif" }}
              >
                Waiting for {opponentPlayer?.display_name || 'Opponent'} to tap and reveal.
              </p>
              <div
                className="mt-3 inline-flex items-center gap-1 text-[10px] text-neutral-400 uppercase tracking-wider"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                <Clock className="w-3 h-3 text-[#FA5A00]" />
                <span>Pending Opponent</span>
              </div>
            </div>
          ) : !bothRevealed ? (
            /* Opponent Revealed, but waiting for current player */
            <div className="w-full h-56 bg-black border border-neutral-700 p-5 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 bg-black border border-emerald-500/60 flex items-center justify-center text-emerald-400 mb-3">
                <Check className="w-6 h-6 stroke-[3]" />
              </div>
              <div
                className="text-sm sm:text-base text-white uppercase tracking-wide mb-1 font-bold"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                Opponent Revealed!
              </div>
              <p
                className="text-[11px] text-neutral-400 max-w-[200px]"
                style={{ fontFamily: "'Outfit', sans-serif" }}
              >
                Reveal your card to uncover both positions and unlock the debate.
              </p>
            </div>
          ) : (
            /* Both revealed: reveal opponent's side */
            <div
              className={`w-full h-56 p-5 flex flex-col items-center justify-center text-center border bg-black ${
                opponentPlayer.assigned_side === 'FOR'
                  ? 'border-emerald-500'
                  : 'border-red-500'
              }`}
            >
              <div
                className={`w-12 h-12 flex items-center justify-center mb-2 border ${
                  opponentPlayer.assigned_side === 'FOR'
                    ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500'
                    : 'bg-red-950/40 text-red-400 border-red-500'
                }`}
              >
                {opponentPlayer.assigned_side === 'FOR' ? (
                  <Shield className="w-6 h-6 stroke-[2.5]" />
                ) : (
                  <Swords className="w-6 h-6 stroke-[2.5]" />
                )}
              </div>

              <span
                className={`text-[9px] font-extrabold uppercase tracking-widest px-2 py-0.5 border mb-1.5 ${
                  opponentPlayer.assigned_side === 'FOR'
                    ? 'text-emerald-400 border-emerald-500/40 bg-black'
                    : 'text-red-400 border-red-500/40 bg-black'
                }`}
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                {opponentPlayer.display_name}'s Stance
              </span>

              <div
                className={`text-xl sm:text-2xl tracking-wider uppercase mb-1 font-bold ${
                  opponentPlayer.assigned_side === 'FOR' ? 'text-emerald-400' : 'text-red-400'
                }`}
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                {opponentPlayer.assigned_side === 'FOR' ? 'FOR (AFFIRMATIVE)' : 'AGAINST (NEGATIVE)'}
              </div>

              <p
                className="text-[11px] text-neutral-300 max-w-[240px]"
                style={{ fontFamily: "'Outfit', sans-serif" }}
              >
                {opponentPlayer.assigned_side === 'FOR'
                  ? 'Defending the resolution.'
                  : 'Refuting the resolution.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Start Game Action Section */}
      <div className="w-full max-w-xl bg-black border border-neutral-800 p-5 sm:p-6 text-center">
        {bothRevealed ? (
          <div>
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-black text-emerald-400 border border-emerald-800 text-[10px] font-bold uppercase tracking-widest mb-2.5"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Both Stances Unlocked</span>
            </div>
            <h3
              className="text-lg sm:text-xl text-white uppercase mb-1 font-bold"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              Ready to Battle
            </h3>
            <p
              className="text-xs text-neutral-400 mb-4"
              style={{ fontFamily: "'Outfit', sans-serif" }}
            >
              Stances are locked. Launch the 1v1 debate arena.
            </p>
            <button
              onClick={handleStartGameClick}
              disabled={isStarting}
              className="w-full h-[52px] bg-[#FA5A00] hover:brightness-105 active:scale-[0.99] text-black text-base tracking-wider uppercase flex items-center justify-center gap-2 transition-all cursor-pointer font-extrabold"
              style={{
                fontFamily: "'Chakra Petch', 'Outfit', sans-serif",
                fontWeight: 800,
              }}
            >
              <Play className="w-4 h-4 fill-black text-black" />
              <span>{isStarting ? 'Starting Battle...' : 'START GAME'}</span>
            </button>
          </div>
        ) : (
          <div className="py-2">
            <div
              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-[#FA5A00] mb-1.5"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Waiting for Side Reveals</span>
            </div>
            <p
              className="text-xs text-neutral-400"
              style={{ fontFamily: "'Outfit', sans-serif" }}
            >
              {!currentPlayer.has_revealed_side
                ? 'Tap your card above to reveal your assigned debate stance.'
                : `Waiting for ${opponentPlayer?.display_name || 'your opponent'} to reveal their card...`}
            </p>
          </div>
        )}
      </div>

      {/* Leave Room Option */}
      <div className="text-center mt-4">
        <button
          onClick={onLeaveRoom}
          className="text-xs text-neutral-400 hover:text-white font-bold uppercase tracking-wider transition-colors cursor-pointer"
          style={{ fontFamily: "'Chakra Petch', sans-serif" }}
        >
          Leave Match & Return to Menu
        </button>
      </div>
    </div>
  );
};

