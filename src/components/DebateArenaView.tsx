import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Match, MatchPlayer, MatchRound, RoundPhase } from '../types/game';
import {
  fetchRoundState,
  submitArgument,
  advanceNextRound,
  resetPlayAgain,
  cleanupMatchData,
} from '../services/gameService';
import { PHASE_RULES, countWords, formatTimeMMSS, getPhaseDisplayName } from '../utils/debateRules';
import {
  Swords,
  Shield,
  Scale,
  Sparkles,
  Flame,
  CheckCircle2,
  AlertCircle,
  Clock,
  Trophy,
  RefreshCw,
  Send,
  Lock,
  Eye,
  Trash2,
  LogOut,
  ArrowRight,
  User,
  Award,
  Layers,
  Sparkle,
  Copy,
  Check,
} from 'lucide-react';

interface DebateArenaViewProps {
  match: Match;
  players: MatchPlayer[];
  currentPlayer: MatchPlayer;
  opponentPlayer: MatchPlayer | null;
  onFinishMatch: () => Promise<void>;
  onRestartMatch?: (newMatch: Match, newPlayer: MatchPlayer) => void;
  onRefreshMatch?: () => Promise<void>;
  isRealtimeActive?: boolean;
  roundRefreshTrigger?: number;
}

export const DebateArenaView: React.FC<DebateArenaViewProps> = ({
  match,
  players,
  currentPlayer,
  opponentPlayer,
  onFinishMatch,
  onRestartMatch,
  onRefreshMatch,
  isRealtimeActive = false,
  roundRefreshTrigger = 0,
}) => {
  // Round state from server
  const [currentRound, setCurrentRound] = useState<MatchRound | null>(null);
  const [allRounds, setAllRounds] = useState<MatchRound[]>([]);
  const [mySubmissions, setMySubmissions] = useState<{
    BLIND: string | null;
    COUNTER: string | null;
    CONCLUSION: string | null;
  }>({ BLIND: null, COUNTER: null, CONCLUSION: null });
  const [opponentSubmissions, setOpponentSubmissions] = useState<{
    BLIND: string | null;
    COUNTER: string | null;
    CONCLUSION: string | null;
  }>({ BLIND: null, COUNTER: null, CONCLUSION: null });
  const [hasSubmittedCurrent, setHasSubmittedCurrent] = useState(false);
  const [opponentSubmittedCurrent, setOpponentSubmittedCurrent] = useState(false);
  const [overallWinner, setOverallWinner] = useState<'A' | 'B' | 'DRAW' | null>(null);

  // Form input
  const [argumentDraft, setArgumentDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Authoritative timing state
  const [phaseEndsAt, setPhaseEndsAt] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(120);

  // Polling / fetching ref
  const isFetchingRef = useRef(false);

  const loadRoundState = useCallback(async (force = false) => {
    if (isFetchingRef.current && !force) return;
    isFetchingRef.current = true;
    console.log('[ROUND STATE] refetching');
    try {
      const res = await fetchRoundState(match.id, currentPlayer.player_id);
      if (res.success && res.round) {
        console.log('[ROUND STATE] phase =', res.round.phase);
        setCurrentRound(res.round);
        if (res.mySubmissions) setMySubmissions(res.mySubmissions);
        if (res.visibleOpponentSubmissions) setOpponentSubmissions(res.visibleOpponentSubmissions);
        setHasSubmittedCurrent(Boolean(res.hasSubmittedCurrentPhase));
        setOpponentSubmittedCurrent(Boolean(res.opponentSubmittedCurrentPhase));
        if (res.allRounds) setAllRounds(res.allRounds);
        if (res.overallWinner) setOverallWinner(res.overallWinner);

        // Sync authoritative timing
        const endsAt = res.timing?.phase_ends_at || res.round.phase_ends_at;
        if (endsAt) {
          setPhaseEndsAt(endsAt);
          if (res.timing?.remaining_seconds !== undefined) {
            setRemainingSeconds(res.timing.remaining_seconds);
          } else {
            const left = Math.max(0, Math.round((new Date(endsAt).getTime() - Date.now()) / 1000));
            setRemainingSeconds(left);
          }
        }

        // If match transitioned, trigger parent refresh
        if (res.matchStatus && res.matchStatus !== match.status && onRefreshMatch) {
          onRefreshMatch();
        }
      }
    } catch (err) {
      console.error('[Arena] Error fetching round state:', err);
    } finally {
      isFetchingRef.current = false;
    }
  }, [match.id, match.status, currentPlayer.player_id, onRefreshMatch]);

  // Real-time second countdown ticker linked to authoritative phase_ends_at
  useEffect(() => {
    if (!phaseEndsAt) return;
    const tick = () => {
      const endsMs = new Date(phaseEndsAt).getTime();
      const left = Math.max(0, Math.round((endsMs - Date.now()) / 1000));
      setRemainingSeconds(left);
      if (left <= 0 && ['BLIND', 'COUNTER', 'CONCLUSION'].includes(currentRound?.phase || '')) {
        loadRoundState(true);
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [phaseEndsAt, currentRound?.phase, loadRoundState]);

  // Safe State-Recovery Fallback: Refresh authoritative round state every 2.5s while match is active
  useEffect(() => {
    if (match.status === 'COMPLETED' || match.status === 'EXPIRED') return;
    loadRoundState(true);
    const interval = setInterval(() => {
      loadRoundState(false);
    }, 2500);
    return () => clearInterval(interval);
  }, [match.status, loadRoundState]);

  // React immediately to parent round refresh triggers
  useEffect(() => {
    if (roundRefreshTrigger > 0) {
      loadRoundState(true);
    }
  }, [roundRefreshTrigger, loadRoundState]);

  // React immediately to phase changes in match
  useEffect(() => {
    loadRoundState(true);
  }, [match.current_phase, match.current_round, loadRoundState]);

  // Window focus / visibility sync for multi-tab / multi-device instant recovery
  useEffect(() => {
    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        loadRoundState();
      }
    };
    window.addEventListener('focus', onVisibilityOrFocus);
    window.addEventListener('visibilitychange', onVisibilityOrFocus);
    return () => {
      window.removeEventListener('focus', onVisibilityOrFocus);
      window.removeEventListener('visibilitychange', onVisibilityOrFocus);
    };
  }, [loadRoundState]);

  // Clear all previous match state immediately when a new match is loaded
  useEffect(() => {
    setCurrentRound(null);
    setAllRounds([]);
    setMySubmissions({ BLIND: null, COUNTER: null, CONCLUSION: null });
    setOpponentSubmissions({ BLIND: null, COUNTER: null, CONCLUSION: null });
    setHasSubmittedCurrent(false);
    setOpponentSubmittedCurrent(false);
    setOverallWinner(null);
    setErrorMessage(null);
    setPhaseEndsAt(null);
    setRemainingSeconds(0);
    loadRoundState(true);
  }, [match.id]);

  // Reset text input when phase changes
  useEffect(() => {
    setArgumentDraft('');
    setErrorMessage(null);
  }, [currentRound?.round_number, currentRound?.phase]);

  // Current phase rules & active word counts
  const currentRules = (currentRound?.phase && PHASE_RULES[currentRound.phase]) || {
    durationSeconds: 150,
    minWords: 10,
    maxWords: 0,
    label: 'THE GAMBIT',
  };

  const currentWordCount = countWords(argumentDraft);
  const hasMaxWords = currentRules.maxWords > 0;
  const isWordCountValid =
    currentWordCount >= currentRules.minWords && (!hasMaxWords || currentWordCount <= currentRules.maxWords);
  const isWordCountOver = hasMaxWords && currentWordCount > currentRules.maxWords;
  const isWordCountUnder = currentWordCount < currentRules.minWords;
  const isTimerUrgent = remainingSeconds <= 30 && remainingSeconds > 0;
  const isTimerExpired = remainingSeconds <= 0 && ['BLIND', 'COUNTER', 'CONCLUSION'].includes(currentRound?.phase || '');

  // Handle argument submission
  const handleSubmitArgument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRound || !argumentDraft.trim() || isSubmitting) return;

    const words = countWords(argumentDraft);
    if (words < currentRules.minWords) {
      setErrorMessage(`Your argument has ${words} words. Minimum required is ${currentRules.minWords} words.`);
      return;
    }
    if (hasMaxWords && words > currentRules.maxWords) {
      setErrorMessage(`Your argument has ${words} words. Maximum allowed is ${currentRules.maxWords} words.`);
      return;
    }
    if (isTimerExpired) {
      setErrorMessage('Time has expired for this phase.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const res = await submitArgument(
      match.id,
      currentPlayer.player_id,
      currentRound.round_number,
      currentRound.phase,
      argumentDraft.trim()
    );

    setIsSubmitting(false);

    if (res.success) {
      setArgumentDraft('');
      await loadRoundState();
      if (onRefreshMatch) onRefreshMatch();
    } else {
      if (res.error?.includes('currently in') || res.error?.includes('already submitted')) {
        await loadRoundState();
        if (onRefreshMatch) onRefreshMatch();
      } else {
        setErrorMessage(res.error || 'Failed to submit argument. Please retry.');
      }
    }
  };

  // Handle advancing to next round
  const handleAdvanceRound = async () => {
    if (isAdvancing) return;
    setIsAdvancing(true);
    setErrorMessage(null);

    const res = await advanceNextRound(match.id, currentPlayer.player_id);
    setIsAdvancing(false);

    if (res.success) {
      await loadRoundState();
      if (onRefreshMatch) onRefreshMatch();
    } else {
      setErrorMessage(res.error || 'Failed to advance round.');
    }
  };

  // Handle Play Again (Reset Tournament)
  const handlePlayAgain = async () => {
    if (isRestarting) return;
    setIsRestarting(true);
    setErrorMessage(null);

    const previousTopics = allRounds.map((r) => r.topic).filter(Boolean);
    const res = await resetPlayAgain(
      match.id,
      currentPlayer.player_id,
      currentPlayer.display_name,
      undefined,
      previousTopics
    );
    setIsRestarting(false);

    if (res.success && res.match && res.player && onRestartMatch) {
      onRestartMatch(res.match, res.player);
    } else {
      setErrorMessage(res.error || 'Failed to reset match.');
    }
  };

  // Handle End & Cleanup
  const handleEndMatch = async () => {
    if (window.confirm('Are you sure you want to end this debate match? All temporary match records will be removed.')) {
      setIsCleaningUp(true);
      await onFinishMatch();
      setIsCleaningUp(false);
    }
  };

  // Copy Room Code
  const handleCopyCode = () => {
    navigator.clipboard.writeText(match.room_code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Derived slot information
  const playerA = players.find((p) => p.player_slot === 'A');
  const playerB = players.find((p) => p.player_slot === 'B');
  const mySlot = currentPlayer.player_slot;
  const oppSlot = mySlot === 'A' ? 'B' : 'A';
  const mySide = currentPlayer.assigned_side || 'FOR';
  const oppSide = opponentPlayer?.assigned_side || (mySide === 'FOR' ? 'AGAINST' : 'FOR');

  const roundNum = currentRound?.round_number || match.current_round || 1;
  const currentPhase = currentRound?.phase || match.current_phase || 'BLIND';

  // Calculate scores across all rounds
  const playerAScoreTotal = allRounds.reduce((acc, r) => acc + (r.player_a_score || 0), 0);
  const playerBScoreTotal = allRounds.reduce((acc, r) => acc + (r.player_b_score || 0), 0);
  const playerAWins = allRounds.filter((r) => r.winner === 'A').length;
  const playerBWins = allRounds.filter((r) => r.winner === 'B').length;

  const isMatchComplete = match.status === 'COMPLETED' || (allRounds.length === 3 && allRounds[2]?.phase === 'ROUND_RESULT');

  const renderCountdownTimer = () => {
    let colorClass = 'text-white';
    if (remainingSeconds <= 10) {
      colorClass = 'text-red-500 animate-pulse';
    } else if (remainingSeconds <= 20) {
      colorClass = 'text-yellow-400';
    }

    return (
      <div className="flex items-center justify-between mb-4">
        <div
          className={`font-mono text-4xl sm:text-5xl font-black tracking-tight ${colorClass}`}
        >
          {formatTimeMMSS(remainingSeconds)}
        </div>
        {hasSubmittedCurrent && (
          <span
            className="px-2.5 py-0.5 bg-black border border-emerald-600/50 text-[10px] font-bold text-emerald-400 uppercase tracking-wider"
            style={{ fontFamily: "'Chakra Petch', sans-serif" }}
          >
            Submitted
          </span>
        )}
      </div>
    );
  };

  const getWordCountColor = () => {
    if (isWordCountOver) {
      return 'text-red-500';
    }
    if (isWordCountValid) {
      return 'text-emerald-400';
    }
    return 'text-white';
  };

  const getWordLimitText = () => {
    if (currentRules.maxWords > 0) {
      return `REQUIRED: ${currentRules.minWords}–${currentRules.maxWords} WORDS`;
    }
    return `REQUIRED: MIN ${currentRules.minWords} WORDS`;
  };

  const renderArgumentHeader = () => {
    return (
      <div className="mb-3 text-left space-y-0.5">
        <div
          className="text-xs uppercase font-bold tracking-wider text-white"
          style={{ fontFamily: "'Chakra Petch', sans-serif" }}
        >
          DEFEND YOUR STANCE AS{' '}
          <span className={mySide === 'FOR' ? 'text-emerald-400' : 'text-red-400'}>
            {mySide}
          </span>
        </div>
        <div
          className={`text-xs font-bold uppercase tracking-wider ${getWordCountColor()}`}
          style={{ fontFamily: "'Chakra Petch', sans-serif" }}
        >
          {currentWordCount} WORDS
        </div>
        <div
          className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2"
          style={{ fontFamily: "'Chakra Petch', sans-serif" }}
        >
          {getWordLimitText()}
        </div>
      </div>
    );
  };

  const getTextareaBorderClasses = () => {
    const isDebatePhase = ['BLIND', 'COUNTER', 'CONCLUSION'].includes(currentPhase);
    if (isDebatePhase && remainingSeconds !== null && remainingSeconds !== undefined) {
      if (remainingSeconds <= 10 && remainingSeconds >= 0) {
        return 'border-red-500 focus:border-red-500 ring-1 ring-red-500';
      }
      if (remainingSeconds <= 20 && remainingSeconds > 10) {
        return 'border-yellow-400 focus:border-yellow-400 ring-1 ring-yellow-400';
      }
    }
    return 'border-neutral-800 focus:border-[#FA5A00]';
  };

  // Quit Match Modal & FIZZ OUT Exit Animation State
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [quitProgress, setQuitProgress] = useState(0);
  const quitAnimIdRef = useRef<number | null>(null);

  const startQuitAnimation = () => {
    setShowQuitConfirm(false);
    setIsQuitting(true);
    setQuitProgress(0);

    const DURATION = 1000; // ~1 second
    const startTime = performance.now();

    const frame = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / DURATION);
      setQuitProgress(progress);

      if (progress < 1) {
        quitAnimIdRef.current = requestAnimationFrame(frame);
      } else {
        setTimeout(async () => {
          await onFinishMatch();
        }, 60);
      }
    };

    quitAnimIdRef.current = requestAnimationFrame(frame);
  };

  useEffect(() => {
    return () => {
      if (quitAnimIdRef.current) {
        cancelAnimationFrame(quitAnimIdRef.current);
      }
    };
  }, []);

  const renderQuitButton = () => (
    <button
      type="button"
      onClick={() => setShowQuitConfirm(true)}
      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-sm"
      style={{ fontFamily: "'Chakra Petch', sans-serif" }}
    >
      <LogOut className="w-3.5 h-3.5" />
      <span>QUIT MATCH</span>
    </button>
  );

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-4 sm:py-6 select-none">
      {/* 1. MATCH HEADER BOX */}
      <div className="bg-black border border-neutral-800 p-4 sm:p-5 mb-4">
        <div
          className="text-lg sm:text-xl font-bold text-white uppercase tracking-wider mb-1"
          style={{ fontFamily: "'Chakra Petch', sans-serif" }}
        >
          ROUND {roundNum}
        </div>
        <div
          className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#FA5A00] mb-2"
          style={{ fontFamily: "'Chakra Petch', sans-serif" }}
        >
          {getPhaseDisplayName(currentPhase)}
        </div>
        <div
          className="space-y-1 text-xs font-bold uppercase tracking-wider"
          style={{ fontFamily: "'Chakra Petch', sans-serif" }}
        >
          <div>
            <span className="text-neutral-400">YOUR ASSIGNED POSITION: </span>
            <span className={mySide === 'FOR' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
              {mySide}
            </span>
          </div>
          <div>
            <span className="text-neutral-400">OPPONENT ASSIGNED POSITION: </span>
            <span className={oppSide === 'FOR' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
              {oppSide}
            </span>
          </div>
        </div>
      </div>

      {/* 2. TOPIC BANNER */}
      <div className="bg-black border border-neutral-800 p-5 sm:p-6 text-center mb-4">
        <h2
          className="text-xl sm:text-2xl font-bold text-white max-w-3xl mx-auto leading-snug"
          style={{ fontFamily: "'Chakra Petch', sans-serif" }}
        >
          {currentRound?.topic ? `"${currentRound.topic}"` : 'Generating AI debate topic...'}
        </h2>
      </div>

      {/* Error Message if any */}
      {errorMessage && (
        <div className="mb-6 p-4 rounded-2xl bg-red-950/50 border border-red-800 text-red-200 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-red-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 3. ACTIVE GAMEPLAY PHASES */}

      {/* ---------------------------------------------------- */}
      {/* PHASE 1: BLIND ARGUMENT */}
      {/* ---------------------------------------------------- */}
      {currentPhase === 'BLIND' && (
        <div className="bg-black border border-neutral-800 p-5 sm:p-6 mb-4">
          {/* Countdown timer on the LEFT side */}
          {renderCountdownTimer()}

          {hasSubmittedCurrent ? (
            <div className="space-y-4">
              <div className="p-4 bg-black border border-neutral-800">
                <div
                  className="text-xs uppercase font-bold text-neutral-400 mb-2 flex items-center gap-1.5"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Your Locked Opening Argument ({mySide})</span>
                </div>
                <p className="text-neutral-200 leading-relaxed whitespace-pre-wrap font-sans text-xs">
                  {mySubmissions.BLIND}
                </p>
              </div>

              <div className="p-6 bg-black border border-neutral-800 text-center flex flex-col items-center justify-center py-8">
                <div className="w-10 h-10 bg-black border border-[#FA5A00]/60 flex items-center justify-center text-[#FA5A00] mb-2.5">
                  <Clock className="w-5 h-5" />
                </div>
                <h4
                  className="text-base font-bold text-white uppercase tracking-wider"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  Waiting for Opponent to Submit
                </h4>
                <p className="text-xs text-neutral-400 max-w-md mt-1" style={{ fontFamily: "'Outfit', sans-serif" }}>
                  {opponentSubmittedCurrent
                    ? 'Opponent has submitted! Processing phase transition...'
                    : `${opponentPlayer?.display_name || 'Opponent'} is currently drafting their opening stance. As soon as both debaters submit, both arguments will unlock simultaneously.`}
                </p>
              </div>
              <div className="flex justify-end pt-2">
                {renderQuitButton()}
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmitArgument} className="space-y-4">
              <div>
                {renderArgumentHeader()}
                <textarea
                  value={argumentDraft}
                  onChange={(e) => setArgumentDraft(e.target.value)}
                  placeholder="State your opening thesis clearly. Provide 2-3 logical justifications, citing rationale or principles..."
                  rows={6}
                  className={`w-full px-3.5 py-2.5 bg-black border ${getTextareaBorderClasses()} text-white placeholder-neutral-600 focus:outline-none font-sans leading-relaxed text-xs transition-colors`}
                  maxLength={10000}
                />
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting || !isWordCountValid || isTimerExpired}
                  className="w-full sm:w-auto px-6 py-2.5 bg-[#FA5A00] hover:brightness-105 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed text-black text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {isSubmitting
                      ? 'Locking in Argument...'
                      : isTimerExpired
                      ? 'Time Expired'
                      : isWordCountUnder
                      ? `Need ${currentRules.minWords - currentWordCount} More Words`
                      : isWordCountOver
                      ? `Trim ${currentWordCount - currentRules.maxWords} Words`
                      : 'Lock In Opening Argument'}
                  </span>
                </button>
                <div className="flex justify-end">{renderQuitButton()}</div>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* PHASE 2: COUNTERARGUMENT */}
      {/* ---------------------------------------------------- */}
      {currentPhase === 'COUNTER' && (
        <div className="bg-black border border-neutral-800 p-5 sm:p-6 mb-4">
          {/* Countdown timer on the LEFT side */}
          {renderCountdownTimer()}

          {/* Side-by-side Opening Arguments for review */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div className="p-3.5 bg-black border border-neutral-800">
              <div
                className="text-xs uppercase font-bold text-neutral-400 mb-1.5 flex items-center justify-between"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                <span>Your Opening Stance ({mySide})</span>
                <span className="text-[10px] text-neutral-500 font-mono">Locked</span>
              </div>
              <p className="text-xs text-neutral-300 whitespace-pre-wrap leading-relaxed">
                {mySubmissions.BLIND}
              </p>
            </div>

            <div className="p-3.5 bg-black border border-red-600/40">
              <div
                className="text-xs uppercase font-bold text-red-400 mb-1.5 flex items-center justify-between"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                <span>Opponent's Opening Argument ({oppSide})</span>
                <span className="px-1.5 py-0.2 bg-black border border-red-600/60 text-[10px] font-bold text-red-400 uppercase">Target</span>
              </div>
              <p className="text-xs text-neutral-200 whitespace-pre-wrap leading-relaxed">
                {opponentSubmissions.BLIND || 'Opponent opening stance revealed.'}
              </p>
            </div>
          </div>

          {hasSubmittedCurrent ? (
            <div className="space-y-4">
              <div className="p-4 bg-black border border-neutral-800">
                <div
                  className="text-xs uppercase font-bold text-neutral-400 mb-2 flex items-center gap-1.5"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Your Locked Counterargument</span>
                </div>
                <p className="text-neutral-200 leading-relaxed whitespace-pre-wrap font-sans text-xs">
                  {mySubmissions.COUNTER}
                </p>
              </div>

              <div className="p-6 bg-black border border-neutral-800 text-center flex flex-col items-center justify-center py-8">
                <div className="w-10 h-10 bg-black border border-[#FA5A00]/60 flex items-center justify-center text-[#FA5A00] mb-2.5">
                  <Clock className="w-5 h-5" />
                </div>
                <h4
                  className="text-base font-bold text-white uppercase tracking-wider"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  Waiting for Opponent's Rebuttal
                </h4>
                <p className="text-xs text-neutral-400 max-w-md mt-1" style={{ fontFamily: "'Outfit', sans-serif" }}>
                  {opponentSubmittedCurrent
                    ? 'Opponent has submitted rebuttal! Advancing to closing statements...'
                    : `${opponentPlayer?.display_name || 'Opponent'} is preparing their counterargument. Once both are submitted, we proceed to Phase 3: FINAL STRIKE.`}
                </p>
              </div>
              <div className="flex justify-end pt-2">
                {renderQuitButton()}
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmitArgument} className="space-y-4">
              <div>
                {renderArgumentHeader()}
                <textarea
                  value={argumentDraft}
                  onChange={(e) => setArgumentDraft(e.target.value)}
                  placeholder="Directly counter the points raised in the opponent's argument above. Expose contradictions or logical fallacies..."
                  rows={6}
                  className={`w-full px-3.5 py-2.5 bg-black border ${getTextareaBorderClasses()} text-white placeholder-neutral-600 focus:outline-none font-sans leading-relaxed text-xs transition-colors`}
                  maxLength={1500}
                />
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting || !isWordCountValid || isTimerExpired}
                  className="w-full sm:w-auto px-6 py-2.5 bg-[#FA5A00] hover:brightness-105 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed text-black text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {isSubmitting
                      ? 'Locking in Rebuttal...'
                      : isTimerExpired
                      ? 'Time Expired'
                      : isWordCountUnder
                      ? `Need ${currentRules.minWords - currentWordCount} More Words`
                      : isWordCountOver
                      ? `Trim ${currentWordCount - currentRules.maxWords} Words`
                      : 'Lock In Counterargument'}
                  </span>
                </button>
                <div className="flex justify-end">{renderQuitButton()}</div>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* PHASE 3: CONCLUSION */}
      {/* ---------------------------------------------------- */}
      {currentPhase === 'CONCLUSION' && (
        <div className="bg-black border border-neutral-800 p-5 sm:p-6 mb-4">
          {/* Countdown timer on the LEFT side */}
          {renderCountdownTimer()}

          {/* Debate History Accordion / Review */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div className="p-3.5 bg-black border border-neutral-800 space-y-2.5">
              <div
                className="text-xs uppercase font-bold text-neutral-400 border-b border-neutral-800 pb-1.5"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                Your Debate Record ({mySide})
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-neutral-500" style={{ fontFamily: "'Chakra Petch', sans-serif" }}>1. Opening:</div>
                <p className="text-xs text-neutral-300 mt-0.5 line-clamp-3 leading-relaxed">{mySubmissions.BLIND}</p>
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-neutral-500" style={{ fontFamily: "'Chakra Petch', sans-serif" }}>2. Rebuttal:</div>
                <p className="text-xs text-neutral-300 mt-0.5 line-clamp-3 leading-relaxed">{mySubmissions.COUNTER}</p>
              </div>
            </div>

            <div className="p-3.5 bg-black border border-neutral-800 space-y-2.5">
              <div
                className="text-xs uppercase font-bold text-red-400 border-b border-neutral-800 pb-1.5"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                Opponent's Record ({oppSide})
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-neutral-500" style={{ fontFamily: "'Chakra Petch', sans-serif" }}>1. Opening:</div>
                <p className="text-xs text-neutral-300 mt-0.5 line-clamp-3 leading-relaxed">{opponentSubmissions.BLIND}</p>
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-neutral-500" style={{ fontFamily: "'Chakra Petch', sans-serif" }}>2. Rebuttal:</div>
                <p className="text-xs text-neutral-300 mt-0.5 line-clamp-3 leading-relaxed">{opponentSubmissions.COUNTER}</p>
              </div>
            </div>
          </div>

          {hasSubmittedCurrent ? (
            <div className="space-y-4">
              <div className="p-4 bg-black border border-neutral-800">
                <div
                  className="text-xs uppercase font-bold text-neutral-400 mb-2 flex items-center gap-1.5"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Your Locked Final Statement</span>
                </div>
                <p className="text-neutral-200 leading-relaxed whitespace-pre-wrap font-sans text-xs">
                  {mySubmissions.CONCLUSION}
                </p>
              </div>

              <div className="p-6 bg-black border border-neutral-800 text-center flex flex-col items-center justify-center py-8">
                <div className="w-10 h-10 bg-black border border-[#FA5A00]/60 flex items-center justify-center text-[#FA5A00] mb-2.5">
                  <Clock className="w-5 h-5" />
                </div>
                <h4
                  className="text-base font-bold text-white uppercase tracking-wider"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  Waiting for Opponent's Conclusion
                </h4>
                <p className="text-xs text-neutral-400 max-w-md mt-1" style={{ fontFamily: "'Outfit', sans-serif" }}>
                  Once both final statements are locked, the AI Judge will review all arguments across all phases and score the round.
                </p>
              </div>
              <div className="flex justify-end pt-2">
                {renderQuitButton()}
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmitArgument} className="space-y-4">
              <div>
                {renderArgumentHeader()}
                <textarea
                  value={argumentDraft}
                  onChange={(e) => setArgumentDraft(e.target.value)}
                  placeholder="Synthesize the clash, summarize why your side stands superior despite opponent counterarguments, and provide a definitive closing statement..."
                  rows={6}
                  className={`w-full px-3.5 py-2.5 bg-black border ${getTextareaBorderClasses()} text-white placeholder-neutral-600 focus:outline-none font-sans leading-relaxed text-xs transition-colors`}
                  maxLength={1500}
                />
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting || !isWordCountValid || isTimerExpired}
                  className="w-full sm:w-auto px-6 py-2.5 bg-[#FA5A00] hover:brightness-105 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed text-black text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {isSubmitting
                      ? 'Submitting Conclusion...'
                      : isTimerExpired
                      ? 'Time Expired'
                      : isWordCountUnder
                      ? `Need ${currentRules.minWords - currentWordCount} More Words`
                      : isWordCountOver
                      ? `Trim ${currentWordCount - currentRules.maxWords} Words`
                      : 'Lock In Final Conclusion'}
                  </span>
                </button>
                <div className="flex justify-end">{renderQuitButton()}</div>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* PHASE 4: AI JUDGING IN PROGRESS */}
      {/* ---------------------------------------------------- */}
      {currentPhase === 'AI_JUDGING' && (
        <div className="bg-black border border-neutral-800 p-8 sm:p-12 text-center mb-4">
          <div className="w-12 h-12 bg-black border border-[#FA5A00] flex items-center justify-center text-[#FA5A00] mx-auto mb-4">
            <Sparkles className="w-6 h-6" />
          </div>
          <h3
            className="text-xl sm:text-2xl font-bold text-white uppercase tracking-wider mb-2"
            style={{ fontFamily: "'Chakra Petch', sans-serif" }}
          >
            AI Adjudication in Progress
          </h3>
          <p className="text-neutral-400 text-xs max-w-lg mx-auto leading-relaxed mb-5" style={{ fontFamily: "'Outfit', sans-serif" }}>
            Gemini is thoroughly evaluating both debaters across The Gambit, Counterstrike, and Final Strike.
          </p>
          <div
            className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-black border border-neutral-800 text-xs text-[#FA5A00]"
            style={{ fontFamily: "'Chakra Petch', sans-serif" }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Scoring logical soundness, rhetoric & rebuttal impact...</span>
          </div>

          <div className="flex justify-end pt-4 mt-6 border-t border-neutral-900">
            {renderQuitButton()}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* PHASE 5: ROUND RESULT & VERDICT */}
      {/* ---------------------------------------------------- */}
      {currentPhase === 'ROUND_RESULT' && currentRound && (
        <div className="space-y-4 mb-4">
          {/* Winner Banner */}
          <div
            className={`p-5 sm:p-7 border text-center ${
              currentRound.winner === mySlot
                ? 'bg-black border-emerald-600/70'
                : currentRound.winner === oppSlot
                ? 'bg-black border-red-600/70'
                : 'bg-black border-[#FA5A00]/70'
            }`}
          >
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-black border border-neutral-800 text-xs font-bold uppercase tracking-wider text-[#FA5A00] mb-2.5"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              <Trophy className="w-3.5 h-3.5" />
              <span>Round {roundNum} Official Verdict</span>
            </div>

            <h3
              className="text-2xl sm:text-3xl font-bold text-white uppercase tracking-wider mb-2"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              {currentRound.winner === mySlot
                ? '🏆 YOU WON ROUND ' + roundNum + '!'
                : currentRound.winner === oppSlot
                ? `${opponentPlayer?.display_name || 'Opponent'} Won Round ${roundNum}`
                : 'Round ' + roundNum + ' Ended in a Draw!'}
            </h3>

            {/* Score Comparison Display */}
            <div className="flex items-center justify-center gap-6 my-5">
              <div className="text-center">
                <div
                  className="text-xs uppercase font-bold text-neutral-400"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  {playerA?.display_name || 'Player A'} {mySlot === 'A' && '(YOU)'}
                </div>
                <div className="text-3xl sm:text-4xl font-bold font-mono text-white mt-1">
                  {currentRound.player_a_score ?? 0}
                  <span className="text-xs text-neutral-500 font-sans">/100</span>
                </div>
              </div>

              <div
                className="text-[#FA5A00] font-bold text-base uppercase tracking-widest"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                VS
              </div>

              <div className="text-center">
                <div
                  className="text-xs uppercase font-bold text-neutral-400"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  {playerB?.display_name || 'Player B'} {mySlot === 'B' && '(YOU)'}
                </div>
                <div className="text-3xl sm:text-4xl font-bold font-mono text-white mt-1">
                  {currentRound.player_b_score ?? 0}
                  <span className="text-xs text-neutral-500 font-sans">/100</span>
                </div>
              </div>
            </div>

            {/* AI Judicial Critique Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-left max-w-4xl mx-auto my-5">
              <div className="p-3.5 bg-black border border-neutral-800">
                <div
                  className="text-xs font-bold uppercase tracking-wider text-neutral-300 mb-1.5 flex items-center justify-between"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  <span>{playerA?.display_name || 'Player A'} Judge Critique</span>
                  <span className="font-mono text-[#FA5A00] font-bold">{currentRound.player_a_score}/100</span>
                </div>
                <p className="text-xs text-neutral-300 leading-relaxed font-sans">
                  {currentRound.player_a_reason || 'Strong opening arguments with logical clarity.'}
                </p>
              </div>

              <div className="p-3.5 bg-black border border-neutral-800">
                <div
                  className="text-xs font-bold uppercase tracking-wider text-neutral-300 mb-1.5 flex items-center justify-between"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  <span>{playerB?.display_name || 'Player B'} Judge Critique</span>
                  <span className="font-mono text-[#FA5A00] font-bold">{currentRound.player_b_score}/100</span>
                </div>
                <p className="text-xs text-neutral-300 leading-relaxed font-sans">
                  {currentRound.player_b_reason || 'Compelling counterarguments and persuasive conclusion.'}
                </p>
              </div>
            </div>

            {/* Actions: Next Round or Tournament Winner */}
            <div className="pt-3 flex flex-col sm:flex-row items-center justify-center gap-3">
              {roundNum < 3 ? (
                <button
                  onClick={handleAdvanceRound}
                  disabled={isAdvancing}
                  className="w-full sm:w-auto px-6 py-2.5 bg-[#FA5A00] hover:brightness-105 active:scale-[0.99] text-black text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>{isAdvancing ? 'Generating Next Round Topic...' : `Advance to Round ${roundNum + 1} of 3`}</span>
                </button>
              ) : (
                <div className="w-full">
                  {/* Final Tournament Champion Celebration Card */}
                  <div className="p-5 bg-black border border-[#FA5A00] text-center mb-4">
                    <div className="w-10 h-10 bg-black border border-[#FA5A00] flex items-center justify-center text-[#FA5A00] mx-auto mb-2.5">
                      <Award className="w-5 h-5" />
                    </div>
                    <div
                      className="text-xs uppercase font-bold tracking-widest text-[#FA5A00] mb-1"
                      style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                    >
                      MATCH CONCLUDED (ALL 3 ROUNDS COMPLETE)
                    </div>
                    <h4
                      className="text-xl sm:text-2xl font-bold text-white uppercase tracking-wider"
                      style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                    >
                      {overallWinner === mySlot
                        ? '🏆 CONGRATULATIONS! YOU ARE THE FIZZ OUT CHAMPION!'
                        : overallWinner === oppSlot
                        ? `🏆 ${opponentPlayer?.display_name || 'OPPONENT'} WINS THE TOURNAMENT!`
                        : '🤝 THE TOURNAMENT CONCLUDED IN A TIE!'}
                    </h4>
                    <p className="text-xs text-neutral-400 mt-1" style={{ fontFamily: "'Outfit', sans-serif" }}>
                      Total Points: {playerA?.display_name} ({playerAScoreTotal}) vs {playerB?.display_name} ({playerBScoreTotal})
                    </p>
                  </div>

                  <button
                    onClick={handlePlayAgain}
                    disabled={isRestarting}
                    className="w-full sm:w-auto px-6 py-2.5 bg-[#FA5A00] hover:brightness-105 active:scale-[0.99] text-black text-xs font-extrabold uppercase tracking-wider inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{isRestarting ? 'Creating Fresh Match...' : 'Play Again (New Match & Fresh Topics)'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Full Round Transcript Review Card */}
          <div className="p-5 bg-black border border-neutral-800">
            <h4
              className="font-bold text-sm text-neutral-200 uppercase tracking-wider mb-3 flex items-center gap-2"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              <Layers className="w-4 h-4 text-[#FA5A00]" />
              <span>Full Round {roundNum} Debate Transcript</span>
            </h4>

            <div className="space-y-3">
              {/* Blind */}
              <div className="p-3 bg-black border border-neutral-800">
                <div
                  className="text-xs font-bold uppercase text-neutral-400 mb-1.5"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  Phase 1: THE GAMBIT
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                  <div className="bg-black p-2.5 border border-neutral-800">
                    <span className="font-bold text-neutral-300 block mb-1" style={{ fontFamily: "'Chakra Petch', sans-serif" }}>
                      {playerA?.display_name} ({playerA?.assigned_side}):
                    </span>
                    <span className="text-neutral-400 font-sans">{mySlot === 'A' ? mySubmissions.BLIND : opponentSubmissions.BLIND}</span>
                  </div>
                  <div className="bg-black p-2.5 border border-neutral-800">
                    <span className="font-bold text-neutral-300 block mb-1" style={{ fontFamily: "'Chakra Petch', sans-serif" }}>
                      {playerB?.display_name} ({playerB?.assigned_side}):
                    </span>
                    <span className="text-neutral-400 font-sans">{mySlot === 'B' ? mySubmissions.BLIND : opponentSubmissions.BLIND}</span>
                  </div>
                </div>
              </div>

              {/* Counter */}
              <div className="p-3 bg-black border border-neutral-800">
                <div
                  className="text-xs font-bold uppercase text-neutral-400 mb-1.5"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  Phase 2: COUNTERSTRIKE
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                  <div className="bg-black p-2.5 border border-neutral-800">
                    <span className="font-bold text-neutral-300 block mb-1" style={{ fontFamily: "'Chakra Petch', sans-serif" }}>
                      {playerA?.display_name}:
                    </span>
                    <span className="text-neutral-400 font-sans">{mySlot === 'A' ? mySubmissions.COUNTER : opponentSubmissions.COUNTER}</span>
                  </div>
                  <div className="bg-black p-2.5 border border-neutral-800">
                    <span className="font-bold text-neutral-300 block mb-1" style={{ fontFamily: "'Chakra Petch', sans-serif" }}>
                      {playerB?.display_name}:
                    </span>
                    <span className="text-neutral-400 font-sans">{mySlot === 'B' ? mySubmissions.COUNTER : opponentSubmissions.COUNTER}</span>
                  </div>
                </div>
              </div>

              {/* Conclusion */}
              <div className="p-3 bg-black border border-neutral-800">
                <div
                  className="text-xs font-bold uppercase text-neutral-400 mb-1.5"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  Phase 3: FINAL STRIKE
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                  <div className="bg-black p-2.5 border border-neutral-800">
                    <span className="font-bold text-neutral-300 block mb-1" style={{ fontFamily: "'Chakra Petch', sans-serif" }}>
                      {playerA?.display_name}:
                    </span>
                    <span className="text-neutral-400 font-sans">{mySlot === 'A' ? mySubmissions.CONCLUSION : opponentSubmissions.CONCLUSION}</span>
                  </div>
                  <div className="bg-black p-2.5 border border-neutral-800">
                    <span className="font-bold text-neutral-300 block mb-1" style={{ fontFamily: "'Chakra Petch', sans-serif" }}>
                      {playerB?.display_name}:
                    </span>
                    <span className="text-neutral-400 font-sans">{mySlot === 'B' ? mySubmissions.CONCLUSION : opponentSubmissions.CONCLUSION}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            {renderQuitButton()}
          </div>
        </div>
      )}

      {/* QUIT CONFIRMATION DIALOG: "Are you sure?" */}
      {showQuitConfirm && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-black border border-neutral-800 max-w-sm w-full p-6 text-center shadow-2xl">
            <h3
              className="text-lg sm:text-xl font-bold text-white uppercase tracking-wider mb-2"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              Are you sure?
            </h3>
            <p
              className="text-xs text-neutral-400 mb-6"
              style={{ fontFamily: "'Outfit', sans-serif" }}
            >
              Do you want to forfeit this debate match and exit to the menu?
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setShowQuitConfirm(false)}
                className="flex-1 px-4 py-2.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-white text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                NO
              </button>
              <button
                type="button"
                onClick={startQuitAnimation}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 border border-red-500 text-white text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                YES
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FIZZ OUT EXIT ANIMATION OVERLAY */}
      {isQuitting && (
        <div
          className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden"
          aria-label="FIZZ OUT Exit"
        >
          <div className="text-center px-4">
            <h1
              className="font-glitch text-5xl sm:text-6xl md:text-7xl select-none uppercase tracking-wider"
              style={{
                fontFamily: "'Doctor Glitch', 'Rubik Glitch', sans-serif",
                letterSpacing: '0.06em',
                lineHeight: 1.1,
              }}
            >
              {'FIZZ OUT'.split('').map((char, index) => {
                const color = index < 5 ? '#FFFFFF' : '#FA5A00';
                const reverseIndex = 7 - index;
                const charStart = reverseIndex * 0.08;
                const fadeDuration = 0.25;
                const charEnd = Math.min(1, charStart + fadeDuration);
                let charOpacity = 1;
                if (quitProgress >= charEnd) {
                  charOpacity = 0;
                } else if (quitProgress > charStart) {
                  charOpacity = 1 - (quitProgress - charStart) / fadeDuration;
                }
                const scale = 0.94 + charOpacity * 0.06;

                return (
                  <span
                    key={index}
                    style={{
                      color,
                      opacity: charOpacity,
                      transform: `scale(${scale})`,
                      display: 'inline-block',
                      willChange: 'opacity, transform',
                    }}
                  >
                    {char === ' ' ? '\u00A0' : char}
                  </span>
                );
              })}
            </h1>
          </div>
        </div>
      )}
    </div>
  );
};
