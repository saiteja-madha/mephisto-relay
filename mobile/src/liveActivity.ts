import ChessAnalysisActivity from '../widgets/ChessAnalysisActivity';
import type { LiveAnalysisProps } from './types';

type ChessActivityInstance = ReturnType<typeof ChessAnalysisActivity.start>;

let currentActivity: ChessActivityInstance | null = null;

export async function startLiveActivity(props: LiveAnalysisProps): Promise<void> {
  await endLiveActivities();
  try {
    currentActivity = ChessAnalysisActivity.start(props, 'mephistorelay://analysis');
    console.info('[LiveActivity] started');
  } catch (error) {
    console.warn('[LiveActivity] could not start', error);
  }
}

export async function updateLiveActivity(props: LiveAnalysisProps): Promise<void> {
  try {
    if (currentActivity) {
      await currentActivity.update(props);
      return;
    }
    const instances = ChessAnalysisActivity.getInstances();
    await Promise.all(instances.map((instance) => instance.update(props)));
  } catch (error) {
    console.warn('[LiveActivity] update failed', error);
  }
}

export async function endLiveActivities(
  finalProps?: LiveAnalysisProps,
): Promise<void> {
  const instances = ChessAnalysisActivity.getInstances();
  if (currentActivity && !instances.includes(currentActivity)) {
    instances.push(currentActivity);
  }
  await Promise.all(
    instances.map((instance) =>
      instance.end('immediate', finalProps, new Date()).catch((error) => {
        console.warn('[LiveActivity] end failed', error);
      }),
    ),
  );
  currentActivity = null;
}
