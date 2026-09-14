import React, { useState, useEffect } from 'react';
import { PlusCircle, LogIn, User, EyeOff, Swords, Target } from 'lucide-react';

interface LandingViewProps {
  onCreateRoom: (customName?: string) => void;
  onJoinRoom: (customName?: string) => void;
  playerName: string;
  onUpdatePlayerName?: (name: string) => void;
  onOpenIntro?: () => void;
}

export const LandingView: React.FC<LandingViewProps> = ({
  onCreateRoom,
  onJoinRoom,
  playerName,
  onUpdatePlayerName,
  onOpenIntro,
}) => {
  // Local codename state, defaulting to prop value or 'cipher'
  const [codename, setCodename] = useState<string>(() => playerName || 'cipher');

  useEffect(() => {
    if (playerName && playerName !== codename) {
      setCodename(playerName);
    }
  }, [playerName]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCodename(val);
    if (onUpdatePlayerName) {
      onUpdatePlayerName(val);
    }
  };

  const handleCreate = () => {
    onCreateRoom(codename.trim() || 'cipher');
  };

  const handleJoin = () => {
    onJoinRoom(codename.trim() || 'cipher');
  };

  return (
    <div className="w-full min-h-screen min-h-[100dvh] bg-black text-neutral-100 flex items-center justify-center relative select-none py-6 sm:py-10 px-4 overflow-x-hidden">
      {/* Central Clean Minimal Container */}
      <div className="w-full max-w-2xl px-2 sm:px-6 my-auto flex flex-col items-center justify-center text-center relative z-10">
        {/* FIZZ OUT Title / Logo with Doctor Glitch Font */}
        <div
          onClick={onOpenIntro}
          className="cursor-pointer transition-opacity hover:opacity-90 max-w-full"
          title="Click to view intro"
        >
          <h1
            className="font-glitch text-4xl sm:text-6xl md:text-7xl select-none uppercase tracking-wider"
            style={{
              fontFamily: "'Doctor Glitch', 'Rubik Glitch', sans-serif",
              letterSpacing: '0.06em',
              lineHeight: 1.1,
            }}
          >
            <span className="text-white">FIZZ </span>
            <span className="text-[#FA5A00]">OUT</span>
          </h1>

          {/* Clean Sharp Flat Subtitle */}
          <p
            className="text-[10px] sm:text-xs md:text-[13px] text-neutral-400 uppercase mt-3 sm:mt-5 tracking-[0.14em] sm:tracking-[0.24em] select-none font-medium max-w-full px-1"
            style={{
              fontFamily: "'Outfit', sans-serif",
            }}
          >
            EVERY TOPIC IS A BATTLE. EVERY ARGUMENT IS A WEAPON
          </p>
        </div>

        {/* Action Controls Section: Exact Design from Reference Photo */}
        <div className="w-full max-w-[560px] mt-8 sm:mt-11 flex flex-col items-center">
          {/* Action Buttons Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5 w-full">
            {/* CREATE ROOM BUTTON - Exact Cybernetic Orange Filled Box */}
            <button
              onClick={handleCreate}
              className="relative w-full h-[58px] cursor-pointer group flex items-center justify-center transition-transform active:scale-[0.98]"
              aria-label="Create Room"
            >
              {/* SVG Background with Exact Cybernetic Geometry & Black Accent Cuts */}
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox="0 0 260 58"
                preserveAspectRatio="none"
                fill="none"
              >
                {/* Main Vibrant Orange Body */}
                <path
                  d="M 16 0 
                     L 244 0 
                     L 260 16 
                     L 260 42 
                     L 253 49 
                     L 241 49 
                     L 235 58 
                     L 16 58 
                     L 0 42 
                     L 0 16 
                     Z"
                  fill="#FA5A00"
                  className="transition-colors group-hover:brightness-105"
                />

                {/* Top-Left Corner Black Cybernetic Accent Inset */}
                <path
                  d="M 32 3 L 16 3 L 3 16 L 3 26"
                  stroke="#000000"
                  strokeWidth="2.2"
                  strokeLinecap="square"
                />
                {/* Top-Left Small Edge Notch */}
                <line x1="42" y1="0" x2="42" y2="4" stroke="#000000" strokeWidth="2" />
                {/* Left Edge Small Notch */}
                <line x1="0" y1="34" x2="4" y2="34" stroke="#000000" strokeWidth="2" />

                {/* Bottom-Left Diagonal Black Razor Slash */}
                <line
                  x1="1"
                  y1="40"
                  x2="17"
                  y2="57"
                  stroke="#000000"
                  strokeWidth="2.5"
                  strokeLinecap="square"
                />

                {/* Top-Right Corner Accent */}
                <path
                  d="M 234 3 L 244 3 L 257 16 L 257 24"
                  stroke="#000000"
                  strokeWidth="2"
                  strokeLinecap="square"
                />
                {/* Top-Right Notch */}
                <line x1="224" y1="0" x2="224" y2="4" stroke="#000000" strokeWidth="2" />

                {/* Bottom-Right Stepped Corner Accent Lines */}
                <path
                  d="M 235 58 L 241 49 L 253 49 L 260 42"
                  stroke="#000000"
                  strokeWidth="2"
                  strokeLinecap="square"
                />
                <line
                  x1="243"
                  y1="54"
                  x2="255"
                  y2="54"
                  stroke="#000000"
                  strokeWidth="2.2"
                />
              </svg>

              {/* Button Content: Black Icon & Bold Black Text */}
              <div className="relative z-10 flex items-center justify-center gap-3 px-4">
                <PlusCircle className="w-5 h-5 text-black stroke-[2.5] shrink-0" />
                <span
                  className="text-black text-base sm:text-lg tracking-wider uppercase select-none"
                  style={{
                    fontFamily: "'Chakra Petch', 'Outfit', sans-serif",
                    fontWeight: 800,
                  }}
                >
                  CREATE ROOM
                </span>
              </div>
            </button>

            {/* JOIN ROOM BUTTON - Exact Cybernetic Outlined Box with Segmented Orange Border */}
            <button
              onClick={handleJoin}
              className="relative w-full h-[58px] cursor-pointer group flex items-center justify-center bg-black transition-colors hover:bg-[#FA5A00]/5 active:scale-[0.98]"
              aria-label="Join Room"
            >
              {/* SVG Segmented Orange Frame with Matching Cuts */}
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox="0 0 260 58"
                preserveAspectRatio="none"
                fill="none"
              >
                {/* Top Main Segment */}
                <line x1="44" y1="1" x2="220" y2="1" stroke="#FA5A00" strokeWidth="2" />

                {/* Top-Right Corner Bracket */}
                <path
                  d="M 230 1 L 244 1 L 259 16 L 259 28"
                  stroke="#FA5A00"
                  strokeWidth="2"
                  strokeLinecap="square"
                />

                {/* Right Edge Mid Segment */}
                <line x1="259" y1="32" x2="259" y2="38" stroke="#FA5A00" strokeWidth="2" />

                {/* Bottom-Right Stepped Notch & Bottom Segment */}
                <path
                  d="M 259 42 L 253 49 L 241 49 L 235 57 L 44 57"
                  stroke="#FA5A00"
                  strokeWidth="2"
                  strokeLinecap="square"
                />
                {/* Bottom-Right Offset Accent Tick */}
                <line
                  x1="243"
                  y1="54"
                  x2="255"
                  y2="54"
                  stroke="#FA5A00"
                  strokeWidth="2"
                />

                {/* Bottom-Left Diagonal Segment */}
                <line
                  x1="18"
                  y1="57"
                  x2="1"
                  y2="40"
                  stroke="#FA5A00"
                  strokeWidth="2"
                  strokeLinecap="square"
                />

                {/* Left Edge Mid Segment */}
                <line x1="1" y1="36" x2="1" y2="28" stroke="#FA5A00" strokeWidth="2" />

                {/* Top-Left Corner Bracket */}
                <path
                  d="M 1 24 L 1 16 L 16 1 L 36 1"
                  stroke="#FA5A00"
                  strokeWidth="2"
                  strokeLinecap="square"
                />
              </svg>

              {/* Button Content: Orange Icon & Bold White Text */}
              <div className="relative z-10 flex items-center justify-center gap-3 px-4">
                <LogIn className="w-5 h-5 text-[#FA5A00] stroke-[2.5] shrink-0" />
                <span
                  className="text-white text-base sm:text-lg tracking-wider uppercase select-none"
                  style={{
                    fontFamily: "'Chakra Petch', 'Outfit', sans-serif",
                    fontWeight: 800,
                  }}
                >
                  JOIN ROOM
                </span>
              </div>
            </button>
          </div>

          {/* CODENAME BOX - Compact Chamfered Box Centered */}
          <div className="w-full max-w-[340px] sm:max-w-[360px] mt-4 sm:mt-5 h-[42px] relative flex items-center">
            {/* SVG Chamfered Pill Outline in Vibrant Orange */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 360 42"
              preserveAspectRatio="none"
              fill="none"
            >
              <path
                d="M 12 1 
                   L 348 1 
                   L 359 12 
                   L 359 30 
                   L 348 41 
                   L 12 41 
                   L 1 30 
                   L 1 12 
                   Z"
                fill="#000000"
                stroke="#FA5A00"
                strokeWidth="1.8"
              />
            </svg>

            {/* Input Content: Orange User Icon, Gray 'Codename:', White 'cipher' Value */}
            <div className="relative z-10 w-full h-full flex items-center px-3.5 sm:px-4 gap-2.5 sm:gap-3">
              <User className="w-4 h-4 text-[#FA5A00] stroke-[2.2] shrink-0" />
              <span
                className="text-xs sm:text-sm text-neutral-400 font-medium select-none tracking-wide shrink-0"
                style={{
                  fontFamily: "'Chakra Petch', 'Outfit', sans-serif",
                }}
              >
                Codename:
              </span>
              <input
                type="text"
                value={codename}
                onChange={handleNameChange}
                placeholder="cipher"
                className="bg-transparent text-white font-mono font-bold text-xs sm:text-sm focus:outline-none w-full tracking-wide placeholder:text-neutral-600"
                maxLength={24}
              />
            </div>
          </div>
        </div>

        {/* Small Supporting Feature Information */}
        <div className="mt-8 sm:mt-12 flex flex-wrap items-center justify-center gap-4 sm:gap-6 md:gap-10 text-left max-w-full">
          {/* Feature 1: BLIND ARGUMENTS */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            <EyeOff className="w-4 h-4 sm:w-5 sm:h-5 text-[#FA5A00] shrink-0 stroke-[2.2]" />
            <div>
              <div
                className="text-xs sm:text-[13px] font-bold text-white tracking-wider uppercase leading-none"
                style={{ fontFamily: "'Outfit', sans-serif" }}
              >
                BLIND ARGUMENTS
              </div>
              <div className="text-[10px] sm:text-[11px] text-neutral-500 uppercase tracking-wider mt-1.5 leading-none font-medium">
                THINK FAST
              </div>
            </div>
          </div>

          {/* Flat Crisp Divider - hidden when items wrap */}
          <div className="hidden sm:block h-7 w-px bg-neutral-800 shrink-0" />

          {/* Feature 2: COUNTERSTRIKE */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            <Swords className="w-4 h-4 sm:w-5 sm:h-5 text-[#FA5A00] shrink-0 stroke-[2.2]" />
            <div>
              <div
                className="text-xs sm:text-[13px] font-bold text-white tracking-wider uppercase leading-none"
                style={{ fontFamily: "'Outfit', sans-serif" }}
              >
                COUNTERSTRIKE
              </div>
              <div className="text-[10px] sm:text-[11px] text-neutral-500 uppercase tracking-wider mt-1.5 leading-none font-medium">
                ATTACK SMART
              </div>
            </div>
          </div>

          {/* Flat Crisp Divider - hidden when items wrap */}
          <div className="hidden sm:block h-7 w-px bg-neutral-800 shrink-0" />

          {/* Feature 3: FINAL STRIKE */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            <Target className="w-4 h-4 sm:w-5 sm:h-5 text-[#FA5A00] shrink-0 stroke-[2.2]" />
            <div>
              <div
                className="text-xs sm:text-[13px] font-bold text-white tracking-wider uppercase leading-none"
                style={{ fontFamily: "'Outfit', sans-serif" }}
              >
                FINAL STRIKE
              </div>
              <div className="text-[10px] sm:text-[11px] text-neutral-500 uppercase tracking-wider mt-1.5 leading-none font-medium">
                FINISH STRONG
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
