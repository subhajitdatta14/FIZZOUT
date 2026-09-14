import React from 'react';
import { Database, Wifi, Check, AlertCircle } from 'lucide-react';

interface NavbarProps {
  isSupabaseConnected: boolean;
  isTablesReady?: boolean;
  missingTables?: string[];
  isRealtimeActive: boolean;
  onOpenSetup: () => void;
  onGoHome?: () => void;
  onOpenIntro?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  isSupabaseConnected,
  isTablesReady = false,
  missingTables = [],
  isRealtimeActive,
  onOpenSetup,
  onGoHome,
  onOpenIntro,
}) => {
  return (
    <header className="border-b border-neutral-800 bg-black sticky top-0 z-40 select-none">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Brand with Doctor Glitch font matching Page 2 */}
        <button
          onClick={onOpenIntro || onGoHome}
          className="flex items-center gap-2.5 text-left transition-opacity hover:opacity-90 cursor-pointer"
          title="Return to Intro Screen"
        >
          <div className="w-8 h-8 bg-black flex items-center justify-center border border-[#FA5A00]/40 p-1">
            <img
              src="/fizz_out_poster.svg"
              alt="FIZZ OUT"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="flex items-center gap-2">
            <span
              className="text-lg sm:text-xl uppercase tracking-wider select-none font-glitch"
              style={{
                fontFamily: "'Doctor Glitch', 'Rubik Glitch', sans-serif",
                letterSpacing: '0.04em',
              }}
            >
              <span className="text-white">FIZZ </span>
              <span className="text-[#FA5A00]">OUT</span>
            </span>
            <span
              className="hidden sm:inline-block px-1.5 py-0.5 text-[9px] font-bold tracking-widest uppercase bg-black text-[#FA5A00] border border-[#FA5A00]/40"
              style={{ fontFamily: "'Chakra Petch', 'Outfit', sans-serif" }}
            >
              1V1 DEBATE
            </span>
          </div>
        </button>

        {/* Status indicators and action */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Realtime / Sync status - Static, no pulse */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-black border border-neutral-800">
            {isRealtimeActive ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-neutral-300 text-[11px] hidden sm:inline" style={{ fontFamily: "'Chakra Petch', sans-serif" }}>Realtime Live</span>
              </>
            ) : isTablesReady ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-neutral-400 text-[11px] hidden sm:inline" style={{ fontFamily: "'Chakra Petch', sans-serif" }}>Syncing</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-[#FA5A00]" />
                <span className="text-[#FA5A00] text-[11px] hidden sm:inline" style={{ fontFamily: "'Chakra Petch', sans-serif" }}>Relay Active</span>
              </>
            )}
          </div>

          {/* Database Status Button */}
          <button
            onClick={onOpenSetup}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider border transition-colors cursor-pointer ${
              isTablesReady
                ? 'bg-black text-emerald-400 border-emerald-800 hover:bg-emerald-950/30'
                : isSupabaseConnected
                ? 'bg-black text-[#FA5A00] border-[#FA5A00]/60 hover:bg-[#FA5A00]/10'
                : 'bg-black text-neutral-400 border-neutral-800 hover:bg-neutral-900'
            }`}
            style={{ fontFamily: "'Chakra Petch', sans-serif" }}
          >
            {isTablesReady ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : isSupabaseConnected ? (
              <AlertCircle className="w-3 h-3 text-[#FA5A00]" />
            ) : (
              <Database className="w-3 h-3" />
            )}
            <span>
              {isTablesReady
                ? 'Database Live'
                : isSupabaseConnected && missingTables.length > 0
                ? 'Setup Migration'
                : isSupabaseConnected
                ? 'Setup Tables'
                : 'Local Relay'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};

