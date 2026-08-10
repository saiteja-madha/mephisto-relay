import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import EventSource, { type EventSourceListener } from 'react-native-sse';

import {
  createSession,
  getLatestEvent,
  RelayRequestError,
  stopSession,
} from './src/api';
import { startBackgroundRefresh, stopBackgroundRefresh } from './src/backgroundTask';
import { BoardImage } from './src/components/BoardImage';
import {
  normalizeGameInput,
  normalizeServerUrl,
  toLiveAnalysisProps,
  waitingProps,
} from './src/domain';
import {
  endLiveActivities,
  startLiveActivity,
  updateLiveActivity,
} from './src/liveActivity';
import {
  clearActiveSession,
  readActiveSession,
  readServerUrl,
  saveActiveSession,
  saveServerUrl,
} from './src/storage';
import type {
  ActiveSession,
  PlayerColor,
  RelayEvent,
} from './src/types';

type RelayEventType = RelayEvent['type'];

const configuredUrl =
  (Constants.expoConfig?.extra?.relayUrl as string | undefined) ??
  'http://127.0.0.1:8080';

function messageFromError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'The relay server did not respond in time';
    return error.message;
  }
  return 'Something went wrong';
}

function RelayApp() {
  const [serverUrl, setServerUrl] = useState(configuredUrl);
  const [gameInput, setGameInput] = useState('');
  const [playerColor, setPlayerColor] = useState<PlayerColor>('white');
  const [playerOnly, setPlayerOnly] = useState(false);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [latestEvent, setLatestEvent] = useState<RelayEvent | null>(null);
  const [status, setStatus] = useState('Ready to monitor');
  const [statusKind, setStatusKind] = useState<'idle' | 'working' | 'live' | 'error'>('idle');
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const eventSourceRef = useRef<EventSource<RelayEventType> | null>(null);

  const rendered = activeSession && latestEvent
    ? toLiveAnalysisProps(latestEvent, activeSession)
    : activeSession
      ? waitingProps(activeSession)
      : null;
  const waitingForOpponent =
    Boolean(activeSession?.playerOnly) && latestEvent?.turn === 'opponent';

  const applyRelayEvent = useCallback(
    async (event: RelayEvent, session: ActiveSession) => {
      console.debug('[Relay]', event.type, event);
      setLatestEvent(event);

      if (event.type === 'analysis') {
        setStatus(`Monitoring game ${event.gameId ?? session.gameId}`);
        setStatusKind('live');
      } else if (event.type === 'analysis-error') {
        setStatus(`${event.message ?? 'Engine request failed'}${event.retrying ? ' — retrying' : ''}`);
        setStatusKind('error');
      } else if (event.type === 'stopped') {
        setStatus('Monitoring stopped');
        setStatusKind('idle');
      } else {
        setStatus(event.message ?? 'Connecting to the relay');
        setStatusKind('working');
      }

      await updateLiveActivity(toLiveAnalysisProps(event, session));
    },
    [],
  );

  const connectEvents = useCallback(
    (session: ActiveSession, eventsUrl?: string) => {
      eventSourceRef.current?.close();
      const url =
        eventsUrl ??
        `${session.serverUrl}/api/sessions/${encodeURIComponent(session.sessionId)}/events`;
      const source = new EventSource<RelayEventType>(url, {
        pollingInterval: 2_000,
        // react-native-sse applies this to the lifetime of the streaming XHR,
        // not just connection setup. A finite value therefore tears down a
        // healthy stream at that interval even while heartbeats are arriving.
        timeout: 0,
      });
      eventSourceRef.current = source;

      const listener: EventSourceListener<RelayEventType> = (sourceEvent) => {
        if (!('data' in sourceEvent) || !sourceEvent.data) return;
        try {
          void applyRelayEvent(JSON.parse(sourceEvent.data) as RelayEvent, session);
        } catch (error) {
          console.warn('[SSE] invalid relay event', error);
        }
      };

      (
        [
          'connecting',
          'monitoring',
          'analysis',
          'analysis-error',
          'reconnecting',
          'stopped',
        ] as RelayEventType[]
      ).forEach((type) => source.addEventListener(type, listener));
      source.addEventListener('open', () => console.info('[SSE] connected', url));
      source.addEventListener('error', (event) => {
        console.warn('[SSE] connection interrupted', event);
        setStatus('Live connection interrupted — reconnecting');
        setStatusKind('error');
      });
    },
    [applyRelayEvent],
  );

  useEffect(() => {
    let mounted = true;
    void Promise.all([readServerUrl(), readActiveSession()]).then(
      async ([storedServerUrl, storedSession]) => {
        if (!mounted) return;
        if (storedServerUrl) setServerUrl(storedServerUrl);
        if (!storedSession) return;

        setActiveSession(storedSession);
        setGameInput(storedSession.gameId);
        setPlayerColor(storedSession.playerColor);
        setPlayerOnly(storedSession.playerOnly);
        setStatus('Restoring active analysis');
        setStatusKind('working');
        try {
          const event = await getLatestEvent(storedSession.serverUrl, storedSession.sessionId);
          if (!mounted) return;
          await applyRelayEvent(event, storedSession);
          if (event.type !== 'stopped') connectEvents(storedSession);
        } catch (error) {
          if (!mounted) return;
          setStatus(`Could not restore session: ${messageFromError(error)}`);
          setStatusKind('error');
        }
      },
    );

    return () => {
      mounted = false;
      eventSourceRef.current?.close();
    };
  }, [applyRelayEvent, connectEvents]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || !activeSession) return;
      void getLatestEvent(activeSession.serverUrl, activeSession.sessionId)
        .then((event) => applyRelayEvent(event, activeSession))
        .catch((error) => console.warn('[Foreground] refresh failed', error));
      connectEvents(activeSession);
    });
    return () => subscription.remove();
  }, [activeSession, applyRelayEvent, connectEvents]);

  const start = async () => {
    if (activeSession || starting) return;
    let createdSession: ActiveSession | null = null;
    setStarting(true);
    setLatestEvent(null);
    try {
      const baseUrl = normalizeServerUrl(serverUrl);
      const gameId = normalizeGameInput(gameInput);
      setStatus('Starting remote monitor');
      setStatusKind('working');
      const started = await createSession(baseUrl, gameId, playerColor);
      const session: ActiveSession = {
        serverUrl: baseUrl,
        sessionId: started.sessionId,
        gameId: started.gameId,
        playerColor,
        playerOnly,
      };
      createdSession = session;
      setServerUrl(baseUrl);
      setActiveSession(session);
      await Promise.all([saveServerUrl(baseUrl), saveActiveSession(session)]);
      await startLiveActivity(waitingProps(session));
      connectEvents(session, started.eventsUrl);

      try {
        const backgroundResult = await startBackgroundRefresh();
        if (backgroundResult !== 'enabled') {
          setStatus(
            backgroundResult === 'denied'
              ? 'Monitoring live — background location permission was not granted'
              : 'Monitoring live — background refresh is unavailable in this build',
          );
        }
      } catch (backgroundError) {
        console.warn('[Background] could not enable location refresh', backgroundError);
        setStatus('Monitoring live — background refresh could not be enabled');
      }
    } catch (error) {
      setStatus(messageFromError(error));
      setStatusKind('error');
      if (createdSession) {
        await stopSession(createdSession.serverUrl, createdSession.sessionId).catch(() => {});
      }
      await clearActiveSession();
      setActiveSession(null);
      await endLiveActivities();
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (!activeSession || stopping) return;
    setStopping(true);
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setStatus('Stopping monitor');
    setStatusKind('working');
    try {
      await Promise.allSettled([
        stopSession(activeSession.serverUrl, activeSession.sessionId),
        stopBackgroundRefresh(),
        endLiveActivities(),
        clearActiveSession(),
      ]);
      setActiveSession(null);
      setLatestEvent(null);
      setStatus('Monitoring stopped');
      setStatusKind('idle');
    } finally {
      setStopping(false);
    }
  };

  const refreshState = async () => {
    if (starting || stopping) return;
    setStatus('Refreshing state');
    setStatusKind('working');

    const storedSession = await readActiveSession();
    if (!storedSession) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setActiveSession(null);
      setLatestEvent(null);
      setStatus('Ready to monitor');
      setStatusKind('idle');
      return;
    }

    try {
      const event = await getLatestEvent(storedSession.serverUrl, storedSession.sessionId);
      setActiveSession(storedSession);
      setGameInput(storedSession.gameId);
      setPlayerColor(storedSession.playerColor);
      setPlayerOnly(storedSession.playerOnly);
      await applyRelayEvent(event, storedSession);
      if (event.type !== 'stopped') connectEvents(storedSession);
    } catch (error) {
      if (!(error instanceof RelayRequestError) || error.status !== 404) {
        setStatus(`Could not refresh state: ${messageFromError(error)}`);
        setStatusKind('error');
        return;
      }

      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      await clearActiveSession();
      await endLiveActivities();
      setActiveSession(null);
      setLatestEvent(null);
      setStatus('No active session — ready to monitor');
      setStatusKind('idle');
    }
  };

  const togglePlayerOnly = async (nextValue: boolean) => {
    setPlayerOnly(nextValue);
    if (!activeSession) return;
    const updatedSession = { ...activeSession, playerOnly: nextValue };
    setActiveSession(updatedSession);
    await saveActiveSession(updatedSession);
    if (latestEvent) {
      await updateLiveActivity(toLiveAnalysisProps(latestEvent, updatedSession));
    }
  };

  const evaluation = latestEvent?.evaluation;
  const score =
    evaluation?.score === undefined ? null : String(evaluation.score);
  const isRunning = Boolean(activeSession);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.brandRow}>
              <View style={styles.logo}>
                <Text style={styles.logoPiece}>♞</Text>
              </View>
              <View>
                <Text style={styles.eyebrow}>REMOTE LIVE ANALYSIS</Text>
                <Text style={styles.title}>Mephisto Relay</Text>
              </View>
            </View>
            <Text style={styles.subtitle}>
              Your next move, visible without leaving the game.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Connection</Text>
            <Text style={styles.label}>Relay server</Text>
            <TextInput
              value={serverUrl}
              onChangeText={setServerUrl}
              editable={!isRunning}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://192.168.1.20:8080"
              placeholderTextColor="#56647B"
              style={[styles.input, isRunning && styles.inputDisabled]}
            />
            <Text style={styles.help}>
              On a real iPhone, use your Mac’s LAN address—not 127.0.0.1.
            </Text>

            <Text style={[styles.label, styles.fieldGap]}>Chess.com game ID or URL</Text>
            <TextInput
              value={gameInput}
              onChangeText={setGameInput}
              editable={!isRunning}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="123456789 or chess.com/game/…"
              placeholderTextColor="#56647B"
              style={[styles.input, isRunning && styles.inputDisabled]}
            />

            <Text style={[styles.label, styles.fieldGap]}>Playing as</Text>
            <View style={styles.segment}>
              {(['white', 'black'] as PlayerColor[]).map((color) => {
                const selected = playerColor === color;
                return (
                  <Pressable
                    key={color}
                    disabled={isRunning}
                    onPress={() => setPlayerColor(color)}
                    style={[styles.segmentOption, selected && styles.segmentSelected]}>
                    <Text style={[styles.segmentPiece, color === 'black' && styles.blackPiece]}>
                      {color === 'white' ? '♙' : '♟'}
                    </Text>
                    <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                      {color === 'white' ? 'White' : 'Black'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleCopy}>
                <Text style={styles.toggleTitle}>Only show my move</Text>
                <Text style={styles.help}>Hide analysis while your opponent is thinking.</Text>
              </View>
              <Switch
                value={playerOnly}
                onValueChange={(value) => void togglePlayerOnly(value)}
                trackColor={{ false: '#334155', true: '#075985' }}
                thumbColor={playerOnly ? '#7DD3FC' : '#CBD5E1'}
              />
            </View>

            <View style={styles.buttonRow}>
              <Pressable
                disabled={isRunning || starting}
                onPress={() => void start()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (isRunning || starting) && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}>
                {starting ? (
                  <ActivityIndicator color="#06111F" />
                ) : (
                  <Text style={styles.primaryButtonText}>Start analysis</Text>
                )}
              </Pressable>
              <Pressable
                disabled={!isRunning || stopping}
                onPress={() => void stop()}
                style={({ pressed }) => [
                  styles.stopButton,
                  (!isRunning || stopping) && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}>
                <Text style={styles.stopButtonText}>{stopping ? 'Stopping…' : 'Stop'}</Text>
              </Pressable>
            </View>

            <View style={styles.statusRow}>
              <View style={[styles.statusDot, styles[`status_${statusKind}`]]} />
              <Text style={styles.statusText}>{status}</Text>
            </View>
            <Pressable
              disabled={starting || stopping}
              onPress={() => void refreshState()}
              style={({ pressed }) => [
                styles.refreshButton,
                (starting || stopping) && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}>
              <Text style={styles.refreshButtonText}>Refresh state</Text>
            </Pressable>
          </View>

          <View style={styles.analysisHeader}>
            <View>
              <Text style={styles.sectionTitle}>Current position</Text>
              <Text style={styles.turnText}>
                {rendered?.status ?? 'Start a game to begin'}
              </Text>
            </View>
            {latestEvent?.sideToMove && (
              <View style={styles.turnBadge}>
                <Text style={styles.turnBadgeText}>
                  {latestEvent.sideToMove === 'white' ? 'WHITE' : 'BLACK'} TO MOVE
                </Text>
              </View>
            )}
          </View>

          <BoardImage
            fen={rendered?.fen ?? null}
            orientation={activeSession?.playerColor ?? playerColor}
            primaryMove={waitingForOpponent ? '' : (rendered?.bestMove ?? '')}
            responseMove={waitingForOpponent || playerOnly ? '' : (rendered?.responseMove ?? '')}
            showBoard={Boolean(rendered?.showBoard)}
            loading={statusKind === 'working'}
            waiting={waitingForOpponent}
          />

          <View style={styles.moves}>
            <View style={styles.moveCard}>
              <View style={[styles.moveBar, styles.bestMoveBar]} />
              <View style={styles.moveCopy}>
                <Text style={styles.moveLabel}>
                  {waitingForOpponent ? 'Current state' : (rendered?.bestMoveLabel ?? 'Your best move')}
                </Text>
                <Text style={styles.moveValue}>
                  {waitingForOpponent ? 'Waiting' : (rendered?.bestMove ?? '—')}
                </Text>
              </View>
            </View>

            {!playerOnly && (
              <View style={styles.moveCard}>
                <View style={[styles.moveBar, styles.responseMoveBar]} />
                <View style={styles.moveCopy}>
                  <Text style={styles.moveLabel}>
                    {rendered?.responseLabel || "Opponent's best response"}
                  </Text>
                  <Text style={styles.moveValue}>{rendered?.responseMove || '—'}</Text>
                </View>
              </View>
            )}
          </View>

          {(score || evaluation?.depth) && (
            <Text style={styles.engineMeta}>
              {score ? `Score ${score}` : ''}
              {score && evaluation?.depth ? ' · ' : ''}
              {evaluation?.depth ? `Depth ${evaluation.depth}` : ''}
            </Text>
          )}

          <View style={styles.backgroundNote}>
            <Text style={styles.backgroundIcon}>◉</Text>
            <View style={styles.flex}>
              <Text style={styles.backgroundTitle}>Dynamic Island enabled</Text>
              <Text style={styles.backgroundText}>
                Background location refreshes the Live Activity while monitoring. Stop analysis
                when the game finishes to end location use.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <RelayApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: '#060B14' },
  content: { padding: 20, paddingBottom: 48, gap: 20 },
  hero: { paddingTop: 8, gap: 14 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0C4A6E',
    borderWidth: 1,
    borderColor: '#0EA5E9',
  },
  logoPiece: { color: '#E0F2FE', fontSize: 30 },
  eyebrow: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  title: { color: '#F8FAFC', fontSize: 27, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { color: '#8D9AB1', fontSize: 15, lineHeight: 22 },
  card: {
    backgroundColor: '#0C1422',
    borderWidth: 1,
    borderColor: '#1E2B40',
    borderRadius: 24,
    padding: 18,
  },
  sectionTitle: { color: '#F1F5F9', fontSize: 18, fontWeight: '700' },
  label: { color: '#B7C2D3', fontSize: 12, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  fieldGap: { marginTop: 20 },
  input: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#293750',
    backgroundColor: '#0A101C',
    color: '#F8FAFC',
    fontSize: 15,
    paddingHorizontal: 14,
  },
  inputDisabled: { color: '#94A3B8', opacity: 0.72 },
  help: { color: '#718198', fontSize: 11, lineHeight: 16, marginTop: 7 },
  segment: {
    flexDirection: 'row',
    gap: 8,
    padding: 4,
    borderRadius: 16,
    backgroundColor: '#080E18',
  },
  segmentOption: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  segmentSelected: { backgroundColor: '#1E293B' },
  segmentPiece: { color: '#FFFFFF', fontSize: 21 },
  blackPiece: { color: '#64748B' },
  segmentText: { color: '#708096', fontWeight: '700' },
  segmentTextSelected: { color: '#F8FAFC' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#26334A',
  },
  toggleCopy: { flex: 1, paddingRight: 16 },
  toggleTitle: { color: '#E2E8F0', fontSize: 14, fontWeight: '700' },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 22 },
  primaryButton: {
    flex: 1,
    height: 52,
    borderRadius: 15,
    backgroundColor: '#7DD3FC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#06111F', fontSize: 15, fontWeight: '800' },
  stopButton: {
    width: 96,
    height: 52,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#7F1D1D',
    backgroundColor: '#2A1117',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopButtonText: { color: '#FDA4AF', fontSize: 15, fontWeight: '700' },
  buttonDisabled: { opacity: 0.38 },
  buttonPressed: { transform: [{ scale: 0.98 }] },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 16 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  status_idle: { backgroundColor: '#64748B' },
  status_working: { backgroundColor: '#FBBF24' },
  status_live: { backgroundColor: '#34D399' },
  status_error: { backgroundColor: '#FB7185' },
  statusText: { flex: 1, color: '#9AA8BC', fontSize: 12, lineHeight: 17 },
  refreshButton: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#293750',
    backgroundColor: '#0A101C',
  },
  refreshButtonText: { color: '#7DD3FC', fontSize: 12, fontWeight: '700' },
  analysisHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  turnText: { color: '#8593A8', fontSize: 12, marginTop: 5 },
  turnBadge: {
    borderRadius: 999,
    backgroundColor: '#172033',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  turnBadgeText: { color: '#7DD3FC', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  moves: { flexDirection: 'row', gap: 10 },
  moveCard: {
    flex: 1,
    minHeight: 92,
    flexDirection: 'row',
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#0D1625',
    borderWidth: 1,
    borderColor: '#1E2B40',
  },
  moveBar: { width: 4 },
  bestMoveBar: { backgroundColor: '#38BDF8' },
  responseMoveBar: { backgroundColor: '#FB7185' },
  moveCopy: { flex: 1, justifyContent: 'center', padding: 14 },
  moveLabel: { color: '#8090A6', fontSize: 10, lineHeight: 14, fontWeight: '600' },
  moveValue: { color: '#F8FAFC', fontSize: 23, fontWeight: '800', marginTop: 5 },
  engineMeta: { color: '#64748B', fontSize: 11, textAlign: 'center' },
  backgroundNote: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#0A1822',
    borderWidth: 1,
    borderColor: '#123448',
  },
  backgroundIcon: { color: '#38BDF8', fontSize: 15, marginTop: 1 },
  backgroundTitle: { color: '#BAE6FD', fontSize: 13, fontWeight: '700' },
  backgroundText: { color: '#7891A5', fontSize: 11, lineHeight: 17, marginTop: 4 },
});
