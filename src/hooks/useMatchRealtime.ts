import { useEffect, useState, useCallback, useRef } from 'react';
import { Match, MatchPlayer } from '../types/game';
import { getSupabaseClient, isSupabaseConfigured } from '../services/supabase';
import { fetchMatchDetails } from '../services/gameService';

interface UseMatchRealtimeProps {
  matchId: string | null;
  playerId: string;
  initialMatch: Match | null;
  initialPlayers: MatchPlayer[];
  onUpdate?: (match: Match, players: MatchPlayer[]) => void;
  onRoundUpdate?: () => void;
}

export function useMatchRealtime({
  matchId,
  playerId,
  initialMatch,
  initialPlayers,
  onUpdate,
  onRoundUpdate,
}: UseMatchRealtimeProps) {
  const [match, setMatch] = useState<Match | null>(initialMatch);
  const [players, setPlayers] = useState<MatchPlayer[]>(initialPlayers);
  const [isRealtimeActive, setIsRealtimeActive] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date>(new Date());
  const onUpdateRef = useRef(onUpdate);
  const onRoundUpdateRef = useRef(onRoundUpdate);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    onRoundUpdateRef.current = onRoundUpdate;
  }, [onRoundUpdate]);

  // Sync state when initial props change
  useEffect(() => {
    if (initialMatch) setMatch(initialMatch);
    if (initialPlayers) setPlayers(initialPlayers);
  }, [initialMatch, initialPlayers]);

  const refreshState = useCallback(async () => {
    if (!matchId) return;
    const res = await fetchMatchDetails(matchId);
    if (res.success && res.match && res.players) {
      setMatch(res.match);
      setPlayers(res.players);
      setLastSyncTime(new Date());
      if (onUpdateRef.current) {
        onUpdateRef.current(res.match, res.players);
      }
    }
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;

    let isMounted = true;
    const client = getSupabaseClient();

    if (isSupabaseConfigured && client) {
      // Set up Supabase Realtime channel
      const channel = client.channel(`match_${matchId}`, {
        config: {
          broadcast: { self: true },
          presence: { key: playerId },
        },
      });

      // 1. Listen for changes in matches table
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
          filter: `id=eq.${matchId}`,
        },
        (payload) => {
          if (!isMounted) return;
          if (payload.new && typeof payload.new === 'object') {
            const updatedMatch = payload.new as Match;
            setMatch((prev) => (prev ? { ...prev, ...updatedMatch } : updatedMatch));
            setLastSyncTime(new Date());
          }
          // Also refresh full state to ensure consistency
          refreshState();
          onRoundUpdateRef.current?.();
        }
      );

      // 2. Listen for changes in match_players table
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_players',
          filter: `match_id=eq.${matchId}`,
        },
        () => {
          if (!isMounted) return;
          refreshState();
        }
      );

      // 3. Listen for changes in match_rounds table
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_rounds',
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          console.log('[REALTIME] match_rounds update received', payload);
          if (!isMounted) return;
          refreshState();
          onRoundUpdateRef.current?.();
        }
      );

      // 4. Broadcast events for immediate sub-10ms response
      channel.on('broadcast', { event: 'match_action' }, (payload) => {
        console.log('[REALTIME] broadcast received (match_action)', payload);
        if (!isMounted) return;
        refreshState();
        onRoundUpdateRef.current?.();
      });

      channel.on('broadcast', { event: 'round_phase_transition' }, (payload) => {
        console.log('[REALTIME] broadcast received (round_phase_transition)', payload);
        if (!isMounted) return;
        refreshState();
        onRoundUpdateRef.current?.();
      });

      // 4. Presence tracking
      channel.on('presence', { event: 'sync' }, () => {
        if (!isMounted) return;
        const presenceState = channel.presenceState();
        const activeIds = Object.keys(presenceState);
        setPlayers((prev) =>
          prev.map((p) => ({
            ...p,
            is_connected: activeIds.includes(p.player_id) || p.is_connected,
          }))
        );
      });

      channel.subscribe((status) => {
        if (!isMounted) return;
        if (status === 'SUBSCRIBED') {
          setIsRealtimeActive(true);
          channel.track({
            player_id: playerId,
            online_at: new Date().toISOString(),
          });
        } else {
          setIsRealtimeActive(false);
        }
      });

      // Backup polling interval (every 1.5s) to ensure zero desync even with packet loss
      const pollInterval = setInterval(() => {
        if (isMounted) {
          refreshState();
        }
      }, 1500);

      return () => {
        isMounted = false;
        clearInterval(pollInterval);
        channel.untrack();
        client.removeChannel(channel);
      };
    } else {
      // In standalone / preview mode before Supabase credentials are provided
      setIsRealtimeActive(false);
      // Fast polling (1.2s) ensures two browser windows update instantly
      const pollInterval = setInterval(() => {
        if (isMounted) {
          refreshState();
        }
      }, 1200);

      return () => {
        isMounted = false;
        clearInterval(pollInterval);
      };
    }
  }, [matchId, playerId, refreshState]);

  return {
    match,
    players,
    isRealtimeActive,
    lastSyncTime,
    refreshState,
  };
}
