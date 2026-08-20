export type ResizeFrameCallback = () => void;
export type ResizeFrameScheduler = (
  callback: ResizeFrameCallback,
) => number;
export type ResizeFrameCanceller = (frameId: number) => void;

export interface ResizeScheduler {
  schedule(width: number, height: number): void;
  cancel(): void;
}

/**
 * Coalesce ResizeObserver bursts into one latest-size write per animation frame.
 * Lightweight Charts performs a layout and canvas resize for every `resize()`
 * call, so writing intermediate observer measurements only adds redundant work.
 */
export function createResizeScheduler(
  resize: (width: number, height: number) => void,
  scheduleFrame: ResizeFrameScheduler = (callback) =>
    requestAnimationFrame(callback),
  cancelFrame: ResizeFrameCanceller = (frameId) => cancelAnimationFrame(frameId),
): ResizeScheduler {
  let frameId: number | null = null;
  let pendingSize: { width: number; height: number } | null = null;

  const flush = () => {
    frameId = null;
    const size = pendingSize;
    pendingSize = null;
    if (size) resize(size.width, size.height);
  };

  return {
    schedule(width, height) {
      if (width <= 0 || height <= 0) return;
      pendingSize = { width, height };
      if (frameId === null) frameId = scheduleFrame(flush);
    },
    cancel() {
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
      pendingSize = null;
    },
  };
}
