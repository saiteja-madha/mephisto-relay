import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { getLatestEvent } from './api';
import { toLiveAnalysisProps } from './domain';
import { endLiveActivities, updateLiveActivity } from './liveActivity';
import { clearActiveSession, readActiveSession } from './storage';

export const ANALYSIS_LOCATION_TASK = 'mephisto-analysis-background-location';

TaskManager.defineTask(ANALYSIS_LOCATION_TASK, async ({ error }) => {
  if (error) {
    console.warn('[Background] location task error', error.message);
    return;
  }

  const session = await readActiveSession();
  if (!session) return;

  try {
    const event = await getLatestEvent(session.serverUrl, session.sessionId);
    const props = toLiveAnalysisProps(event, session);
    if (event.type === 'stopped') {
      await endLiveActivities(props);
      await clearActiveSession();
      await stopBackgroundRefresh();
      return;
    }
    await updateLiveActivity(props);
    console.info('[Background] Live Activity refreshed', event.type, event.timestamp);
  } catch (taskError) {
    console.warn('[Background] relay refresh failed', taskError);
  }
});

export async function startBackgroundRefresh(): Promise<
  'enabled' | 'denied' | 'unavailable'
> {
  if (!(await TaskManager.isAvailableAsync())) return 'unavailable';

  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return 'denied';

  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') return 'denied';

  if (await Location.hasStartedLocationUpdatesAsync(ANALYSIS_LOCATION_TASK)) {
    // Restart so a newly installed build applies the latest delivery options.
    await Location.stopLocationUpdatesAsync(ANALYSIS_LOCATION_TASK);
  }

  await Location.startLocationUpdatesAsync(ANALYSIS_LOCATION_TASK, {
    // Keep the process eligible for navigation-style background delivery.
    // This is intentionally battery-intensive while a relay session is active.
    accuracy: Location.Accuracy.BestForNavigation,
    activityType: Location.ActivityType.OtherNavigation,
    distanceInterval: 0,
    timeInterval: 2_000,
    deferredUpdatesDistance: 0,
    deferredUpdatesInterval: 2_000,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
  });
  return 'enabled';
}

export async function stopBackgroundRefresh(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(ANALYSIS_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(ANALYSIS_LOCATION_TASK);
  }
}
