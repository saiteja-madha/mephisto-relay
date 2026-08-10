import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ActiveSession } from './types';

const ACTIVE_SESSION_KEY = '@mephisto-relay/active-session';
const SERVER_URL_KEY = '@mephisto-relay/server-url';

export async function saveActiveSession(session: ActiveSession): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
}

export async function readActiveSession(): Promise<ActiveSession | null> {
  const raw = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveSession;
  } catch {
    await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
    return null;
  }
}

export function clearActiveSession(): Promise<void> {
  return AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
}

export function saveServerUrl(serverUrl: string): Promise<void> {
  return AsyncStorage.setItem(SERVER_URL_KEY, serverUrl);
}

export function readServerUrl(): Promise<string | null> {
  return AsyncStorage.getItem(SERVER_URL_KEY);
}
