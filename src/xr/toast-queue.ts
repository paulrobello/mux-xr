/** Which outside-program toasts are on screen, per placement, with timeouts and same-id updates. */
import type { Toast, ToastEnvelope, ToastPlacement } from '../toast-contract';

/** Cards shown at once per placement; older toasts wait until a slot frees. */
export const TOASTS_PER_PLACEMENT = 3;

/** Center holds one card so it never runs into the top and bottom stacks. */
export const toastSlots = (placement: ToastPlacement): number =>
  placement === 'center' ? 1 : TOASTS_PER_PLACEMENT;
/** Toasts held in total; the oldest is dropped past this. */
export const TOAST_QUEUE_LIMIT = 24;

export interface QueuedToast {
  toast: Toast;
  /** When it leaves, in the queue's clock; Infinity until dismissed. */
  expires: number;
}

export interface ToastQueue {
  /** Applies a pushed toast or dismissal; true when anything shown may have changed. */
  apply(envelope: ToastEnvelope, now: number): boolean;
  dismiss(id: string): boolean;
  /** Drops expired toasts; true when any left. */
  expire(now: number): boolean;
  /** Newest first, at most {@link toastSlots} for the placement. */
  visible(placement: ToastPlacement): QueuedToast[];
  size(): number;
}

export function createToastQueue(): ToastQueue {
  // Oldest first.
  const entries: QueuedToast[] = [];
  const remove = (id: string): boolean => {
    const index = entries.findIndex((entry) => entry.toast.id === id);
    if (index < 0) return false;
    entries.splice(index, 1);
    return true;
  };
  return {
    apply(envelope, now) {
      if (envelope.type === 'dismiss') return remove(envelope.id);
      remove(envelope.toast.id);
      entries.push({
        toast: envelope.toast,
        expires: envelope.toast.timeout ? now + envelope.toast.timeout * 1000 : Infinity,
      });
      while (entries.length > TOAST_QUEUE_LIMIT) entries.shift();
      return true;
    },
    dismiss: remove,
    expire(now) {
      let changed = false;
      for (let index = entries.length - 1; index >= 0; index -= 1)
        if (entries[index].expires <= now) {
          entries.splice(index, 1);
          changed = true;
        }
      return changed;
    },
    visible(placement) {
      const shown: QueuedToast[] = [];
      const slots = toastSlots(placement);
      for (let index = entries.length - 1; index >= 0 && shown.length < slots; index -= 1)
        if (entries[index].toast.placement === placement) shown.push(entries[index]);
      return shown;
    },
    size: () => entries.length,
  };
}
