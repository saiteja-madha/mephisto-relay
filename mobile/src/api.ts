import { absoluteUrl, normalizeServerUrl } from './domain';
import type { PlayerColor, RelayEvent, SessionStartResponse } from './types';

export class RelayRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'RelayRequestError';
    this.status = status;
  }
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new RelayRequestError(
        body.error ?? `Relay request failed (${response.status})`,
        response.status,
      );
    }
    return body as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createSession(
  serverUrl: string,
  gameId: string,
  color: PlayerColor,
): Promise<SessionStartResponse> {
  const baseUrl = normalizeServerUrl(serverUrl);
  const result = await jsonRequest<SessionStartResponse>(`${baseUrl}/api/sessions`, {
    method: 'POST',
    body: JSON.stringify({ gameId, color }),
  });
  return {
    ...result,
    eventsUrl: absoluteUrl(baseUrl, result.eventsUrl),
  };
}

export function getLatestEvent(serverUrl: string, sessionId: string): Promise<RelayEvent> {
  return jsonRequest<RelayEvent>(
    `${normalizeServerUrl(serverUrl)}/api/sessions/${encodeURIComponent(sessionId)}/latest`,
  );
}

export async function stopSession(serverUrl: string, sessionId: string): Promise<void> {
  const response = await fetch(
    `${normalizeServerUrl(serverUrl)}/api/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Unable to stop monitoring (${response.status})`);
  }
}
