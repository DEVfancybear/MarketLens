import {
  patchSettings,
  type SettingsDocument,
  type SettingsPatch,
} from "./resources/settingsApi";

type SettingsSectionName = keyof SettingsDocument;
type SettingsSender = (patch: SettingsPatch) => Promise<unknown>;

export interface SettingsMutationQueue<Section extends SettingsSectionName> {
  enqueue(
    patch: Partial<SettingsDocument[Section]>,
    onError?: (error: unknown) => void,
  ): void;
  cancelPending(): void;
  flush(): Promise<void>;
}

/**
 * Debounces one settings section and serializes writes to preserve the latest
 * user choice when several controls change in quick succession.
 */
export function createSettingsMutationQueue<Section extends SettingsSectionName>(
  section: Section,
  delayMs = 350,
  send: SettingsSender = patchSettings,
): SettingsMutationQueue<Section> {
  let pending: Partial<SettingsDocument[Section]> = {};
  let pendingErrorHandler: ((error: unknown) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writeQueue: Promise<void> = Promise.resolve();
  let generation = 0;

  const dispatch = () => {
    timer = null;
    if (Object.keys(pending).length === 0) return;

    const sectionPatch = pending;
    const onError = pendingErrorHandler;
    const batchGeneration = generation;
    pending = {};
    pendingErrorHandler = undefined;

    writeQueue = writeQueue
      .catch(() => undefined)
      .then(() => {
        if (batchGeneration !== generation) return;
        return send({
          [section]: sectionPatch,
        } as SettingsPatch);
      })
      .then(() => undefined)
      .catch((error) => {
        if (batchGeneration === generation) onError?.(error);
      });
  };

  return {
    enqueue(patch, onError) {
      pending = { ...pending, ...patch };
      pendingErrorHandler = onError ?? pendingErrorHandler;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(dispatch, delayMs);
    },
    cancelPending() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = {};
      pendingErrorHandler = undefined;
      generation += 1;
    },
    flush() {
      if (timer !== null) clearTimeout(timer);
      dispatch();
      return writeQueue;
    },
  };
}
