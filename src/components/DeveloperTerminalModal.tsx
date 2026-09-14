import React from 'react';
import { useIsMobileOrTablet } from '../utils/device';

interface DeveloperTerminalModalProps {
  isOpen: boolean;
  onClose?: () => void;
}

export const DeveloperTerminalModal: React.FC<DeveloperTerminalModalProps> = ({
  isOpen,
  onClose,
}) => {
  const isMobileOrTablet = useIsMobileOrTablet();

  return (
    <div
      className={`fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm select-none transition-all duration-300 ease-out ${
        isOpen
          ? 'opacity-100 pointer-events-auto'
          : 'opacity-0 pointer-events-none'
      }`}
      aria-label="Developer Information"
      role="dialog"
      aria-modal="true"
      aria-hidden={!isOpen}
    >
      {/* Terminal Card - Premium Black & Dark-Orange Cyber Aesthetic */}
      <div
        className={`relative w-full max-w-[380px] bg-black border border-[#FA5A00]/80 shadow-[0_0_35px_rgba(250,90,0,0.22)] p-6 sm:p-7 text-center transition-all duration-300 ease-out ${
          isOpen ? 'scale-100 translate-y-0 opacity-100' : 'scale-95 translate-y-2 opacity-0'
        }`}
      >
        {/* Subtle Cybernetic Corner Ticks */}
        <div className="absolute top-0 left-0 w-2.5 h-2.5 border-t-2 border-l-2 border-[#FA5A00]" />
        <div className="absolute top-0 right-0 w-2.5 h-2.5 border-t-2 border-r-2 border-[#FA5A00]" />
        <div className="absolute bottom-0 left-0 w-2.5 h-2.5 border-b-2 border-l-2 border-[#FA5A00]" />
        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 border-b-2 border-r-2 border-[#FA5A00]" />

        {/* Terminal Content - Exactly as specified */}
        <div className="font-mono text-center space-y-2.5 py-1">
          <div
            className="text-white text-xs sm:text-sm font-bold tracking-[0.18em] uppercase select-text"
            style={{
              fontFamily: "'Chakra Petch', monospace",
              letterSpacing: '0.16em',
            }}
          >
            DEVELOPED BY SUBHAJIT DATTA
          </div>
          <div
            className="text-[#FA5A00] text-xs sm:text-sm font-bold tracking-[0.2em] uppercase select-text"
            style={{
              fontFamily: "'Chakra Petch', monospace",
              letterSpacing: '0.18em',
            }}
          >
            12TH SEPTEMBER 2026
          </div>
        </div>

        {/* Single EXIT button - Smartphone & Tablet Only */}
        {isMobileOrTablet && (
          <div className="mt-5 pt-3 border-t border-neutral-900 flex justify-center">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 bg-black hover:bg-[#FA5A00]/10 active:scale-95 text-[#FA5A00] border border-[#FA5A00]/70 hover:border-[#FA5A00] text-xs font-bold uppercase tracking-widest transition-all cursor-pointer select-none"
              style={{
                fontFamily: "'Chakra Petch', sans-serif",
                letterSpacing: '0.18em',
              }}
            >
              EXIT
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
