/**
 * FIZZ OUT: Real-time, Two-Player Online Debate Competition Game
 * @license Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Match, MatchPlayer } from './types/game';
import {
  getOrCreatePlayerId,
  getCachedPlayerName,
  setCachedPlayerName,
} from './utils/session';
import {
  createMatchRoom,
  joinMatchRoom,
  revealPlayerSide,
  startMatchGame,
  cleanupMatchData,
} from './services/gameService';
import { isSupabaseConfigured } from './services/supabase';
import { useMatchRealtime } from './hooks/useMatchRealtime';

import { IntroScreenView } from './components/IntroScreenView';
import { CodenamePageView } from './components/CodenamePageView';
import { LandingView } from './components/LandingView';
import { PlayerIdentityModal } from './components/PlayerIdentityModal';
import { CreateRoomView } from './components/CreateRoomView';
import { JoinRoomView } from './components/JoinRoomView';
import { LobbyBattleView } from './components/LobbyBattleView';
import { DebateArenaView } from './components/DebateArenaView';
import { SupabaseSetupModal } from './components/SupabaseSetupModal';
import { DeveloperTerminalModal } from './components/DeveloperTerminalModal';

export default function App() {
  const [playerId] = useState<string>(() => getOrCreatePlayerId());
  // Codename is ephemeral: every time app opens or page is refreshed, user enters a new codename
  const [playerName, setPlayerName] = useState<string>('');

  // Developer terminal modal state (Alt+S to open, Alt+D to close)
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);

  // Show the official Intro Screen first, then Codename selection, then Landing Page
  const [activeView, setActiveView] = useState<'INTRO' | 'CODENAME' | 'LANDING' | 'CREATE' | 'JOIN'>('INTRO');
  const [isIdentityModalOpen, setIsIdentityModalOpen] = useState(false);
  const [identityAction, setIdentityAction] = useState<'create' | 'join'>('create');
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);

  const [currentMatch, setCurrentMatch] = useState<Match | null>(null);
  const [currentPlayers, setCurrentPlayers] = useState<MatchPlayer[]>([]);
  const [serverStatus, setServerStatus] = useState<{
    supabaseConfigured: boolean;
    supabaseTablesReady: boolean;
    geminiConfigured: boolean;
    missingTables: string[];
  }>({
    supabaseConfigured: isSupabaseConfigured,
    supabaseTablesReady: false,
    geminiConfigured: false,
    missingTables: [],
  });

  const checkServerStatus = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/supabase/status');
      if (res.ok) {
        const data = await res.json();
        setServerStatus({
          supabaseConfigured: Boolean(data.configured || isSupabaseConfigured),
          supabaseTablesReady: Boolean(data.tablesReady),
          geminiConfigured: false,
          missingTables: Array.isArray(data.missingTables) ? data.missingTables : [],
        });
        return Boolean(data.tablesReady);
      }
    } catch {
      // ignore
    }
    return false;
  }, []);

  // Check server configuration on mount
  useEffect(() => {
    fetch('/api/config')
      .then((res) => {
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          return res.json();
        }
        return null;
      })
      .then((data) => {
        if (data && typeof data.supabaseConfigured === 'boolean') {
          setServerStatus({
            supabaseConfigured: Boolean(data.supabaseConfigured || isSupabaseConfigured),
            supabaseTablesReady: Boolean(data.supabaseTablesReady),
            geminiConfigured: Boolean(data.geminiConfigured),
            missingTables: Array.isArray(data.missingTables) ? data.missingTables : [],
          });
        }
      })
      .catch(() => {
        // Fallback to client-side detection
      });
  }, []);

  // Global Keyboard Shortcuts: Alt+S (open terminal) and Alt+D (close terminal)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check Alt + S or Alt + s
      const isAltS =
        e.altKey &&
        (e.code === 'KeyS' ||
          e.key === 's' ||
          e.key === 'S' ||
          e.key.toLowerCase() === 's' ||
          e.key === 'ß');

      if (isAltS) {
        e.preventDefault();
        e.stopPropagation();
        setIsTerminalOpen(true);
        return;
      }

      // Check Alt + D or Alt + d
      const isAltD =
        e.altKey &&
        (e.code === 'KeyD' ||
          e.key === 'd' ||
          e.key === 'D' ||
          e.key.toLowerCase() === 'd' ||
          e.key === '∂');

      if (isAltD) {
        e.preventDefault();
        e.stopPropagation();
        setIsTerminalOpen(false);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, []);

  // Hook for live realtime updates between both players
  const [roundRefreshTrigger, setRoundRefreshTrigger] = useState(0);
  const handleRealtimeUpdate = useCallback((updatedMatch: Match, updatedPlayers: MatchPlayer[]) => {
    setCurrentMatch(updatedMatch);
    setCurrentPlayers(updatedPlayers);
  }, []);

  const handleRoundUpdate = useCallback(() => {
    setRoundRefreshTrigger((prev) => prev + 1);
  }, []);

  const { isRealtimeActive, refreshState } = useMatchRealtime({
    matchId: currentMatch?.id || null,
    playerId,
    initialMatch: currentMatch,
    initialPlayers: currentPlayers,
    onUpdate: handleRealtimeUpdate,
    onRoundUpdate: handleRoundUpdate,
  });

  // Identify current player and opponent player
  const currentPlayer = useMemo(() => {
    return currentPlayers.find((p) => p.player_id === playerId) || null;
  }, [currentPlayers, playerId]);

  const opponentPlayer = useMemo(() => {
    return currentPlayers.find((p) => p.player_id !== playerId) || null;
  }, [currentPlayers, playerId]);

  // Handle "Create Room" initiation
  const handleCreateRoomClick = (customName?: string) => {
    const targetName = (customName !== undefined ? customName : playerName).trim();
    if (!targetName) {
      setIdentityAction('create');
      setIsIdentityModalOpen(true);
      return;
    }
    executeCreateRoom(targetName);
  };

  const executeCreateRoom = async (name: string) => {
    setCachedPlayerName(name);
    setPlayerName(name);
    const res = await createMatchRoom(name, playerId);
    if (res.success && res.match && res.player) {
      setCurrentMatch(res.match);
      setCurrentPlayers([res.player]);
      setActiveView('CREATE');
    } else {
      if (
        res.error?.toLowerCase().includes('supabase') ||
        res.error?.toLowerCase().includes('database') ||
        res.error?.toLowerCase().includes('tables are not initialized')
      ) {
        setIsSetupModalOpen(true);
      }
      alert(res.error || 'Failed to create room. Please try again.');
    }
  };

  // Handle "Join Room" initiation
  const handleJoinRoomClick = (customName?: string) => {
    const targetName = (customName !== undefined ? customName : playerName).trim();
    if (targetName) {
      setCachedPlayerName(targetName);
      setPlayerName(targetName);
    }
    setActiveView('JOIN');
  };

  const handleJoinSubmit = async (
    roomCode: string,
    name: string
  ): Promise<{ success: boolean; error?: string }> => {
    setCachedPlayerName(name);
    setPlayerName(name);

    const res = await joinMatchRoom(roomCode, name, playerId);
    if (res.success && res.match && res.player) {
      setCurrentMatch(res.match);
      setCurrentPlayers(res.players || [res.player]);
      return { success: true };
    }
    if (
      res.error?.toLowerCase().includes('supabase') ||
      res.error?.toLowerCase().includes('database') ||
      res.error?.toLowerCase().includes('tables are not initialized')
    ) {
      setIsSetupModalOpen(true);
    }
    return { success: false, error: res.error };
  };

  // Handle Side Reveal
  const handleRevealSide = async () => {
    if (!currentMatch) return;
    const res = await revealPlayerSide(currentMatch.id, playerId);
    if (res.success && res.match && res.players) {
      setCurrentMatch(res.match);
      setCurrentPlayers(res.players);
    } else if (!res.success && res.error) {
      alert(res.error);
    }
  };

  // Handle Start Game
  const handleStartGame = async () => {
    if (!currentMatch) return;
    const res = await startMatchGame(currentMatch.id, playerId);
    if (res.success && res.match) {
      setCurrentMatch(res.match);
      if (res.players) setCurrentPlayers(res.players);
    } else if (!res.success && res.error) {
      alert(res.error);
    }
  };

  // Handle Cleanup / Leave Match
  const handleLeaveOrCleanupMatch = async () => {
    if (currentMatch) {
      await cleanupMatchData(currentMatch.id, playerId);
    }
    setCurrentMatch(null);
    setCurrentPlayers([]);
    setActiveView('LANDING');
  };

  // Handle Play Again / Restart Match
  const handleMatchRestart = (newMatch: Match, newPlayer: MatchPlayer) => {
    setCurrentMatch(newMatch);
    setCurrentPlayers([newPlayer]);
    setActiveView('CREATE');
  };

  const handleEnterCodename = useCallback(() => {
    setActiveView('CODENAME');
  }, []);

  const handleConfirmCodename = useCallback((name: string) => {
    setPlayerName(name);
    setActiveView('LANDING');
  }, []);

  // If on the official Intro Screen (Page 1)
  if (activeView === 'INTRO' && !currentMatch) {
    return (
      <div className="min-h-screen bg-black text-neutral-100 flex flex-col font-sans select-none">
        <IntroScreenView onEnter={handleEnterCodename} />
        <DeveloperTerminalModal
          isOpen={isTerminalOpen}
          onClose={() => setIsTerminalOpen(false)}
        />
      </div>
    );
  }

  // If on the Codename Screen (between Page 1 and Page 2)
  if (activeView === 'CODENAME' && !currentMatch) {
    return (
      <div className="min-h-screen bg-black text-neutral-100 flex flex-col font-sans select-none">
        <CodenamePageView
          onConfirm={handleConfirmCodename}
          initialValue={playerName}
          onOpenTerminal={() => setIsTerminalOpen(true)}
        />
        <DeveloperTerminalModal
          isOpen={isTerminalOpen}
          onClose={() => setIsTerminalOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen min-h-[100dvh] bg-black text-neutral-100 flex flex-col font-sans selection:bg-[#FA5A00] selection:text-black overflow-x-hidden">
      {/* Main Game Stage */}
      <main className="flex-1 w-full flex flex-col items-center justify-center relative">
        {/* VIEW 1: Active Match in progress or completed */}
        {currentMatch &&
        (currentMatch.status === 'IN_PROGRESS' || currentMatch.status === 'COMPLETED') &&
        currentPlayer ? (
          <DebateArenaView
            match={currentMatch}
            players={currentPlayers}
            currentPlayer={currentPlayer}
            opponentPlayer={opponentPlayer}
            onFinishMatch={handleLeaveOrCleanupMatch}
            onRestartMatch={handleMatchRestart}
            onRefreshMatch={refreshState}
            isRealtimeActive={isRealtimeActive}
            roundRefreshTrigger={roundRefreshTrigger}
          />
        ) : /* VIEW 2: Both players present, waiting for side reveals or game start */
        currentMatch &&
          (currentMatch.status === 'READY' ||
            currentMatch.status === 'REVEALING' ||
            currentPlayers.length === 2) &&
          currentPlayer ? (
          <LobbyBattleView
            match={currentMatch}
            players={currentPlayers}
            currentPlayer={currentPlayer}
            opponentPlayer={opponentPlayer}
            onRevealSide={handleRevealSide}
            onStartGame={handleStartGame}
            onLeaveRoom={handleLeaveOrCleanupMatch}
            isRealtimeActive={isRealtimeActive}
          />
        ) : /* VIEW 3: Host waiting in created room for opponent */
        currentMatch && currentMatch.status === 'WAITING' && currentPlayer ? (
          <CreateRoomView
            match={currentMatch}
            player={currentPlayer}
            isRealtimeActive={isRealtimeActive}
            onCancel={handleLeaveOrCleanupMatch}
          />
        ) : /* VIEW 4: Join room form */
        activeView === 'JOIN' ? (
          <JoinRoomView
            initialPlayerName={playerName}
            onJoin={handleJoinSubmit}
            onBack={() => setActiveView('LANDING')}
          />
        ) : (
          /* VIEW 5: Landing Page (Page 2) */
          <LandingView
            onCreateRoom={handleCreateRoomClick}
            onJoinRoom={handleJoinRoomClick}
            playerName={playerName}
            onUpdatePlayerName={(name: string) => {
              setCachedPlayerName(name);
              setPlayerName(name);
            }}
            onOpenIntro={() => setActiveView('INTRO')}
          />
        )}
      </main>

      {/* Player Display Name Prompt Modal */}
      <PlayerIdentityModal
        isOpen={isIdentityModalOpen}
        actionType={identityAction}
        initialName={playerName}
        onClose={() => setIsIdentityModalOpen(false)}
        onSubmit={(name) => {
          setIsIdentityModalOpen(false);
          if (identityAction === 'create') {
            executeCreateRoom(name);
          } else {
            setCachedPlayerName(name);
            setPlayerName(name);
            setActiveView('JOIN');
          }
        }}
      />

      {/* Supabase Configuration & Schema Modal */}
      <SupabaseSetupModal
        isOpen={isSetupModalOpen}
        isConfigured={serverStatus.supabaseConfigured}
        tablesReady={serverStatus.supabaseTablesReady}
        missingTables={serverStatus.missingTables}
        onRecheck={checkServerStatus}
        onClose={() => setIsSetupModalOpen(false)}
      />

      {/* Developer Terminal Modal (Alt+S to open, Alt+D to close, or EXIT button on mobile) */}
      <DeveloperTerminalModal
        isOpen={isTerminalOpen}
        onClose={() => setIsTerminalOpen(false)}
      />
    </div>
  );
}
