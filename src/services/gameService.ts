import { CreateRoomResponse, JoinRoomResponse, Match, MatchPlayer } from '../types/game';
import {
  saveMatchSessionToken,
  getMatchSessionToken,
  clearMatchSessionToken,
} from '../utils/session';

async function parseJsonResponse<T = any>(
  res: Response,
  actionName: string
): Promise<{ success: boolean; data?: T; error?: string }> {
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.toLowerCase().includes('application/json');

  if (isJson) {
    try {
      const data = await res.json();
      return {
        success: res.ok && data?.success !== false,
        data,
        error: data?.error,
      };
    } catch {
      return {
        success: false,
        error: `Invalid JSON response received from server during ${actionName}.`,
      };
    }
  }

  // Handle non-JSON responses (HTML error page, Vercel SPA redirect, proxy 502/504)
  const text = await res.text();
  const trimmed = text.trim();
  const isHtml = trimmed.startsWith('<!DOCTYPE') || trimmed.includes('<html') || trimmed.includes('<body');

  if (isHtml) {
    if (res.status === 404 || res.status === 200) {
      return {
        success: false,
        error: `Backend API route not reached (Server returned HTML). Check Vercel serverless deployment and vercel.json API routing.`,
      };
    }
    return {
      success: false,
      error: `Server returned an HTML error page (${res.status} ${res.statusText || 'Error'}). Please check backend server logs and environment variables.`,
    };
  }

  return {
    success: false,
    error: trimmed
      ? `Server error (${res.status}): ${trimmed.slice(0, 120)}`
      : `Failed to complete ${actionName} (${res.status} ${res.statusText || 'Error'}).`,
  };
}

export async function createMatchRoom(displayName: string, playerId: string): Promise<CreateRoomResponse> {
  try {
    const res = await fetch('/api/matches/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, playerId }),
    });
    const parsed = await parseJsonResponse<CreateRoomResponse>(res, 'Create Room');
    if (!parsed.success || !parsed.data) {
      return {
        success: false,
        error: parsed.error || parsed.data?.error || 'Failed to create room.',
      };
    }
    const data = parsed.data;
    if (data.success && data.match?.id && data.sessionToken) {
      saveMatchSessionToken(data.match.id, data.sessionToken);
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error creating match.' };
  }
}

export async function joinMatchRoom(
  roomCode: string,
  displayName: string,
  playerId: string
): Promise<JoinRoomResponse & { players?: MatchPlayer[] }> {
  try {
    // If player had a session token for this room/player from earlier, include it
    const existingToken = sessionStorage.getItem(`fizzout_match_token_rejoin_${roomCode.toUpperCase()}`);
    const res = await fetch('/api/matches/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(existingToken ? { 'X-Player-Session-Token': existingToken } : {}),
      },
      body: JSON.stringify({
        roomCode,
        displayName,
        playerId,
        sessionToken: existingToken || undefined,
      }),
    });
    const parsed = await parseJsonResponse<JoinRoomResponse & { players?: MatchPlayer[] }>(res, 'Join Room');
    if (!parsed.success || !parsed.data) {
      return {
        success: false,
        error: parsed.error || parsed.data?.error || 'Failed to join match.',
      };
    }
    const data = parsed.data;
    if (data.success && data.match?.id && data.sessionToken) {
      saveMatchSessionToken(data.match.id, data.sessionToken);
      try {
        sessionStorage.setItem(`fizzout_match_token_rejoin_${roomCode.toUpperCase()}`, data.sessionToken);
      } catch {
        // ignore
      }
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error joining match.' };
  }
}

export async function fetchMatchDetails(
  matchId: string
): Promise<{ success: boolean; match?: Match; players?: MatchPlayer[]; error?: string }> {
  try {
    const res = await fetch(`/api/matches/${matchId}`);
    const parsed = await parseJsonResponse<{ success: boolean; match?: Match; players?: MatchPlayer[]; error?: string }>(res, 'Fetch Match');
    if (!parsed.success || !parsed.data) {
      return {
        success: false,
        error: parsed.error || parsed.data?.error || 'Failed to fetch match details.',
      };
    }
    return parsed.data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to fetch match details.' };
  }
}

export async function revealPlayerSide(
  matchId: string,
  playerId: string,
  token?: string
): Promise<{ success: boolean; match?: Match; players?: MatchPlayer[]; error?: string }> {
  try {
    const sessionToken = token || getMatchSessionToken(matchId) || '';
    const res = await fetch('/api/matches/reveal-side', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Player-Session-Token': sessionToken,
      },
      body: JSON.stringify({ matchId, playerId, sessionToken }),
    });
    const parsed = await parseJsonResponse<{ success: boolean; match?: Match; players?: MatchPlayer[]; error?: string }>(res, 'Reveal Side');
    if (!parsed.success || !parsed.data) {
      return {
        success: false,
        error: parsed.error || parsed.data?.error || 'Failed to reveal side.',
      };
    }
    return parsed.data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to reveal side.' };
  }
}

export async function startMatchGame(
  matchId: string,
  playerId: string,
  token?: string,
  previousTopics?: string[]
): Promise<{ success: boolean; match?: Match; players?: MatchPlayer[]; error?: string }> {
  try {
    const sessionToken = token || getMatchSessionToken(matchId) || '';
    const res = await fetch('/api/matches/start-game', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Player-Session-Token': sessionToken,
      },
      body: JSON.stringify({ matchId, playerId, sessionToken, previousTopics }),
    });
    const parsed = await parseJsonResponse<{ success: boolean; match?: Match; players?: MatchPlayer[]; error?: string }>(res, 'Start Game');
    if (!parsed.success || !parsed.data) {
      return {
        success: false,
        error: parsed.error || parsed.data?.error || 'Failed to start game.',
      };
    }
    return parsed.data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to start game.' };
  }
}

export async function cleanupMatchData(
  matchId: string,
  playerId?: string,
  token?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const sessionToken = token || getMatchSessionToken(matchId) || '';
    const res = await fetch('/api/matches/cleanup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Player-Session-Token': sessionToken,
      },
      body: JSON.stringify({ matchId, playerId, sessionToken }),
    });
    clearMatchSessionToken(matchId);
    const parsed = await parseJsonResponse<{ success: boolean; error?: string }>(res, 'Cleanup Match');
    if (!parsed.success || !parsed.data) {
      return {
        success: false,
        error: parsed.error || parsed.data?.error || 'Failed to clean up match data.',
      };
    }
    return parsed.data;
  } catch (err: any) {
    clearMatchSessionToken(matchId);
    return { success: false, error: err?.message || 'Failed to clean up match data.' };
  }
}

export async function fetchRoundState(
  matchId: string,
  playerId: string,
  token?: string
): Promise<any> {
  try {
    const sessionToken = token || getMatchSessionToken(matchId) || '';
    const res = await fetch(`/api/matches/round-state?matchId=${encodeURIComponent(matchId)}&playerId=${encodeURIComponent(playerId)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Player-Session-Token': sessionToken,
      },
    });
    const parsed = await parseJsonResponse<any>(res, 'Fetch Round State');
    if (!parsed.success || !parsed.data) {
      return {
        success: false,
        error: parsed.error || parsed.data?.error || 'Failed to fetch round state.',
      };
    }
    return parsed.data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to fetch round state.' };
  }
}

export async function submitArgument(
  matchId: string,
  playerId: string,
  roundNumber: number,
  phase: string,
  argumentText: string,
  token?: string
): Promise<any> {
  try {
    const sessionToken = token || getMatchSessionToken(matchId) || '';
    const res = await fetch('/api/matches/submit-argument', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Player-Session-Token': sessionToken,
      },
      body: JSON.stringify({
        matchId,
        playerId,
        roundNumber,
        phase,
        argumentText,
      }),
    });
    const parsed = await parseJsonResponse<any>(res, 'Submit Argument');
    if (!parsed.success || !parsed.data) {
      return {
        success: false,
        error: parsed.error || parsed.data?.error || 'Failed to submit argument.',
      };
    }
    return parsed.data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to submit argument.' };
  }
}

export async function advanceNextRound(
  matchId: string,
  playerId: string,
  token?: string
): Promise<any> {
  try {
    const sessionToken = token || getMatchSessionToken(matchId) || '';
    const res = await fetch('/api/matches/next-round', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Player-Session-Token': sessionToken,
      },
      body: JSON.stringify({
        matchId,
        playerId,
      }),
    });
    const parsed = await parseJsonResponse<any>(res, 'Advance Round');
    if (!parsed.success || !parsed.data) {
      return {
        success: false,
        error: parsed.error || parsed.data?.error || 'Failed to advance to next round.',
      };
    }
    return parsed.data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to advance to next round.' };
  }
}

export async function resetPlayAgain(
  matchId: string,
  playerId: string,
  displayName: string,
  token?: string,
  previousTopics?: string[]
): Promise<any> {
  try {
    const sessionToken = token || getMatchSessionToken(matchId) || '';
    const res = await fetch('/api/matches/reset-play-again', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Player-Session-Token': sessionToken,
      },
      body: JSON.stringify({
        matchId,
        playerId,
        displayName,
        previousTopics,
      }),
    });
    const parsed = await parseJsonResponse<any>(res, 'Reset Play Again');
    if (!parsed.success || !parsed.data) {
      return {
        success: false,
        error: parsed.error || parsed.data?.error || 'Failed to restart match.',
      };
    }
    const data = parsed.data;
    if (data.success && data.match?.id && data.sessionToken) {
      saveMatchSessionToken(data.match.id, data.sessionToken);
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to restart match.' };
  }
}
