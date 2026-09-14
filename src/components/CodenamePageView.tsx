import React, { useState, useRef, useEffect, useCallback } from 'react';
import { User, ArrowRight, Shield } from 'lucide-react';
import { isMobileOrTabletDevice } from '../utils/device';

interface CodenamePageViewProps {
  onConfirm: (codename: string) => void;
  initialValue?: string;
  onOpenTerminal?: () => void;
}

const SUGGESTED_CODENAMES = [
  'ShadowFox',
  'BlazeRider',
  'NightHawk',
  'CyberGhost',
  'RedVortex',
  'StormBreaker',
] as const;

export const CodenamePageView: React.FC<CodenamePageViewProps> = ({
  onConfirm,
  initialValue = '',
  onOpenTerminal,
}) => {
  const [codename, setCodename] = useState<string>(initialValue);
  const [hasError, setHasError] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Touch-and-hold state for smartphone & tablet (approx 3 seconds)
  const holdTimerRef = useRef<number | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    touchStartPos.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearHoldTimer();
    };
  }, [clearHoldTimer]);

  const handleTitleTouchStart = (e: React.TouchEvent) => {
    // Smartphone & tablet only
    if (!isMobileOrTabletDevice()) return;

    clearHoldTimer();
    if (e.touches.length > 0) {
      touchStartPos.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };

      // 3 seconds hold requirement (preventing accidental short taps)
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null;
        touchStartPos.current = null;
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try {
            navigator.vibrate(40);
          } catch {
            // ignore
          }
        }
        onOpenTerminal?.();
      }, 3000);
    }
  };

  const handleTitleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPos.current) return;
    if (e.touches.length > 0) {
      const deltaX = Math.abs(e.touches[0].clientX - touchStartPos.current.x);
      const deltaY = Math.abs(e.touches[0].clientY - touchStartPos.current.y);
      // Cancel hold if finger moves or scrolls more than 10px
      if (deltaX > 10 || deltaY > 10) {
        clearHoldTimer();
      }
    }
  };

  const handleTitleTouchEnd = () => {
    clearHoldTimer();
  };

  const handleTitleTouchCancel = () => {
    clearHoldTimer();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = codename.trim();
    if (!trimmed) {
      setHasError(true);
      return;
    }
    onConfirm(trimmed);
  };

  const handleSelectSuggestion = (suggested: string) => {
    setCodename(suggested);
    setHasError(false);
  };

  const isFormValid = codename.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black text-neutral-100 flex flex-col items-center justify-center select-none overflow-y-auto overflow-x-hidden px-4 py-6 sm:py-8"
      aria-label="Codename Selection Page"
    >
      {/* Central Clean Container matching FIZZ OUT aesthetic */}
      <div className="w-full max-w-md my-auto flex flex-col items-center justify-center text-center">
        {/* Title: CODENAME (using exact FIZZ OUT font style) with smartphone/tablet 3s touch-and-hold */}
        <div
          className="mb-2 flex flex-col items-center select-none"
          onTouchStart={handleTitleTouchStart}
          onTouchMove={handleTitleTouchMove}
          onTouchEnd={handleTitleTouchEnd}
          onTouchCancel={handleTitleTouchCancel}
          onContextMenu={(e) => {
            if (isMobileOrTabletDevice()) {
              e.preventDefault();
            }
          }}
          style={{
            WebkitTouchCallout: 'none',
          }}
        >
          <h1
            className="font-glitch text-4xl sm:text-5xl md:text-6xl select-none uppercase tracking-wider leading-none cursor-default"
            style={{
              fontFamily: "'Doctor Glitch', 'Rubik Glitch', sans-serif",
              letterSpacing: '0.06em',
            }}
          >
            <span className="text-white">CODE</span>
            <span className="text-[#FA5A00]">NAME</span>
          </h1>
        </div>

        {/* Form Container */}
        <form onSubmit={handleSubmit} className="w-full mt-6 flex flex-col items-center">
          {/* Cybernetic Chamfered Input Box */}
          <div
            onClick={() => inputRef.current?.focus()}
            className="w-full max-w-[360px] h-[48px] relative flex items-center cursor-text"
          >
            {/* SVG Chamfered Frame */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none transition-colors duration-200"
              viewBox="0 0 360 48"
              preserveAspectRatio="none"
              fill="none"
            >
              <path
                d="M 14 1 
                   L 346 1 
                   L 359 14 
                   L 359 34 
                   L 346 47 
                   L 14 47 
                   L 1 34 
                   L 1 14 
                   Z"
                fill="#000000"
                stroke={hasError ? '#EF4444' : isFocused ? '#FA5A00' : '#262626'}
                strokeWidth={isFocused || hasError ? '1.8' : '1.2'}
              />
            </svg>

            {/* Input Content */}
            <div className="relative z-10 w-full h-full flex items-center px-4 gap-3">
              <User
                className={`w-4 h-4 stroke-[2.2] shrink-0 transition-colors ${
                  hasError ? 'text-red-500' : isFocused ? 'text-[#FA5A00]' : 'text-neutral-500'
                }`}
              />
              <input
                ref={inputRef}
                type="text"
                value={codename}
                onChange={(e) => {
                  setCodename(e.target.value);
                  if (hasError) setHasError(false);
                }}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder="Enter codename..."
                autoFocus
                maxLength={20}
                data-max-sound="20"
                className="bg-transparent text-white font-mono font-bold text-xs sm:text-sm focus:outline-none w-full tracking-wide placeholder:text-neutral-600"
              />
            </div>
          </div>

          {/* Validation message if user attempts to submit without codename */}
          {hasError && (
            <p
              className="text-[11px] text-red-500 font-medium tracking-wider uppercase mt-2 select-none"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              A codename is required to proceed
            </p>
          )}

          {/* Suggested Codenames Header */}
          <div className="w-full max-w-[360px] mt-6">
            <div
              className="text-[10px] sm:text-[11px] text-neutral-500 font-bold uppercase tracking-[0.2em] mb-2.5 text-center"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              SUGGESTED CODENAMES
            </div>

            {/* Suggested Codenames 6 Grid / Chips */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {SUGGESTED_CODENAMES.map((suggestion) => {
                const isSelected = codename.trim() === suggestion;
                return (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => handleSelectSuggestion(suggestion)}
                    className={`h-9 px-2 text-[11px] font-bold tracking-wider uppercase transition-all cursor-pointer flex items-center justify-center border select-none active:scale-[0.97] ${
                      isSelected
                        ? 'bg-[#FA5A00] text-black border-[#FA5A00] shadow-[0_0_12px_rgba(250,90,0,0.35)]'
                        : 'bg-black text-neutral-300 border-neutral-800 hover:border-[#FA5A00] hover:text-[#FA5A00]'
                    }`}
                    style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                  >
                    {suggestion}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Unique Action Button to Proceed to Page 2 */}
          <div className="w-full max-w-[360px] mt-7">
            <button
              type="submit"
              disabled={!isFormValid}
              className={`relative w-full h-[54px] flex items-center justify-center transition-all cursor-pointer select-none active:scale-[0.98] ${
                !isFormValid ? 'opacity-40 cursor-not-allowed' : 'hover:brightness-105'
              }`}
              aria-label="Confirm Codename and Enter Arena"
            >
              {/* SVG Cybernetic Angled Frame */}
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox="0 0 360 54"
                preserveAspectRatio="none"
                fill="none"
              >
                {/* Vibrant Orange Body with Cybernetic Chamfer Cuts */}
                <path
                  d="M 18 0 
                     L 342 0 
                     L 360 18 
                     L 360 36 
                     L 342 54 
                     L 18 54 
                     L 0 36 
                     L 0 18 
                     Z"
                  fill="#FA5A00"
                />
                {/* Tech Inset Accents */}
                <line x1="24" y1="4" x2="336" y2="4" stroke="#000000" strokeWidth="1.5" />
                <line x1="24" y1="50" x2="336" y2="50" stroke="#000000" strokeWidth="1.5" />
                <line x1="3" y1="27" x2="10" y2="27" stroke="#000000" strokeWidth="2.5" />
                <line x1="350" y1="27" x2="357" y2="27" stroke="#000000" strokeWidth="2.5" />
              </svg>

              {/* Button Content */}
              <div className="relative z-10 flex items-center justify-center gap-2.5 px-4 text-black">
                <Shield className="w-4 h-4 stroke-[2.5] shrink-0" />
                <span
                  className="text-sm sm:text-base font-extrabold uppercase tracking-wider"
                  style={{ fontFamily: "'Chakra Petch', sans-serif" }}
                >
                  ENTER ARENA
                </span>
                <ArrowRight className="w-4 h-4 stroke-[2.5] shrink-0" />
              </div>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
