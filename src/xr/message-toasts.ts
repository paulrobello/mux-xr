/**
 * Cards for toasts that outside programs post through the host service. Each placement owns a
 * small pool of cards built once, so a new toast only retypes text and recolors the accent.
 */
import * as THREE from 'three';
import { getControlHelp } from '../control-help';
import {
  TOAST_PLACEMENTS,
  type ToastEnvelope,
  type ToastLevel,
  type ToastPlacement,
} from '../toast-contract';
import { createScalableLabel, updateScalableLabel } from './labels';
import { createToastQueue, type QueuedToast, toastSlots } from './toast-queue';
import { disposeOwned } from './widgets';

export const TOAST_CARD_WIDTH = 0.86;
export const TOAST_CARD_HEIGHT = 0.15;
const CARD_GAP = 0.02;
const STRIPE_WIDTH = 0.026;
const CLOSE_SIZE = 0.06;
/** Long messages shrink below this to fit the card. */
const TEXT_FONT_SIZE = 0.028;
const CARD_BACKGROUND = 0x101820;
/** Distance in front of the head for top, center and bottom placements. */
const VIEW_DISTANCE = 1.25;
// Top stacks down and bottom stacks up from here, leaving the single center card clear.
const VIEW_OFFSET: Record<'top' | 'center' | 'bottom', number> = {
  top: 0.52,
  center: 0,
  bottom: -0.52,
};
/** Above the HUD's notice row (0.3) and clipboard toast (0.45), in HUD units. */
const HUD_OFFSET = 0.62;
const HUD_SCALE = 1.5;
const PANE_GAP = 0.06;
/** How quickly view-placed cards catch up with the head, per second. */
const FOLLOW_RATE = 3;
// Above the HUD overlays (40), so a toast is never hidden behind a terminal or widget.
const RENDER_ORDER = 45;

const LEVEL_TAGS: Record<ToastLevel, string> = {
  info: 'INFO',
  success: 'OK',
  warn: 'WARN',
  error: 'ERROR',
};

export interface ToastAnchors {
  camera: THREE.Camera;
  hud: THREE.Object3D | null;
  /** The pane to sit above (null means the selected pane), with its half height in local units. */
  pane: (paneId: string | null) => { object: THREE.Object3D; top: number } | null;
}

export interface MessageToastLayer {
  root: THREE.Group;
  /** True when a card changed; the caller may play a cue for a newly shown toast. */
  apply(envelope: ToastEnvelope, now: number): boolean;
  dismiss(id: string): boolean;
  update(now: number, deltaSeconds: number, anchors: ToastAnchors): void;
  /** Ids on screen, newest first per placement, for checks. */
  shown(): Record<ToastPlacement, string[]>;
  dispose(): void;
}

interface Card {
  group: THREE.Group;
  plate: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  stripe: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  text: THREE.Mesh;
  close: THREE.Mesh;
  id: string | null;
}

interface Stack {
  group: THREE.Group;
  cards: Card[];
  /** Whether it was drawn last frame, so a stack that reappears snaps instead of gliding. */
  placed: boolean;
}

/** The two lines a card shows: level, title and source, then the message. */
export function toastCardText(entry: QueuedToast): string {
  const { toast } = entry;
  const header = [LEVEL_TAGS[toast.level], toast.title, toast.source].filter(Boolean).join(' · ');
  return `${header}\n${toast.message}`;
}

function overlay(object: THREE.Object3D, order: number): void {
  object.traverse((child) => {
    const material = (child as THREE.Mesh).material;
    for (const value of Array.isArray(material) ? material : material ? [material] : []) {
      value.depthTest = false;
      value.depthWrite = false;
    }
    child.renderOrder = order;
  });
}

function createCard(placement: ToastPlacement, index: number): Card {
  const group = new THREE.Group();
  group.name = `xr-toast-${placement}-${index + 1}`;
  group.visible = false;
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(TOAST_CARD_WIDTH, TOAST_CARD_HEIGHT),
    // Opaque, so it draws in the same pass as the stripe and never covers it.
    new THREE.MeshBasicMaterial({ color: CARD_BACKGROUND }),
  );
  plate.name = 'xr-toast-plate';
  plate.userData.inputAction = 'dismissToast';
  plate.userData.helpText = getControlHelp({ inputAction: 'dismissToast' });
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(STRIPE_WIDTH, TOAST_CARD_HEIGHT),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  stripe.name = 'xr-toast-stripe';
  stripe.position.set(-TOAST_CARD_WIDTH / 2 + STRIPE_WIDTH / 2, 0, 0.001);
  stripe.raycast = () => undefined;
  const textWidth = TOAST_CARD_WIDTH - STRIPE_WIDTH - CLOSE_SIZE - 0.05;
  const text = createScalableLabel('', textWidth, TOAST_CARD_HEIGHT - 0.02, {
    backplate: false,
    wrap: true,
    align: 'left',
    fontSize: TEXT_FONT_SIZE,
  });
  text.name = 'xr-toast-text';
  text.raycast = () => undefined;
  text.position.set(-TOAST_CARD_WIDTH / 2 + STRIPE_WIDTH + 0.02 + textWidth / 2, 0, 0.002);
  const close = createScalableLabel('×', CLOSE_SIZE, CLOSE_SIZE, { background: '#223946' });
  close.name = 'xr-toast-close';
  close.userData.inputAction = 'dismissToast';
  close.userData.helpText = getControlHelp({ inputAction: 'dismissToast' });
  close.position.set(
    TOAST_CARD_WIDTH / 2 - CLOSE_SIZE / 2 - 0.015,
    TOAST_CARD_HEIGHT / 2 - CLOSE_SIZE / 2 - 0.015,
    0.002,
  );
  group.add(plate, stripe, text, close);
  overlay(plate, RENDER_ORDER);
  overlay(stripe, RENDER_ORDER + 1);
  overlay(text, RENDER_ORDER + 2);
  overlay(close, RENDER_ORDER + 2);
  return { group, plate, stripe, text, close, id: null };
}

/** Where card `index` sits in its stack: newest nearest the anchor, older ones away from it. */
export function cardOffset(placement: ToastPlacement, index: number): number {
  const pitch = TOAST_CARD_HEIGHT + CARD_GAP;
  if (placement === 'top' || placement === 'center') return -index * pitch;
  return index * pitch;
}

export function createMessageToastLayer(): MessageToastLayer {
  const root = new THREE.Group();
  root.name = 'xr-message-toasts';
  const queue = createToastQueue();
  const stacks = new Map<ToastPlacement, Stack>();
  let disposed = false;
  const head = new THREE.Vector3();
  const headQuaternion = new THREE.Quaternion();
  const target = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const anchorScale = new THREE.Vector3();

  const stackFor = (placement: ToastPlacement): Stack => {
    let stack = stacks.get(placement);
    if (!stack) {
      const group = new THREE.Group();
      group.name = `xr-toasts-${placement}`;
      group.visible = false;
      const cards: Card[] = [];
      for (let index = 0; index < toastSlots(placement); index += 1) {
        const card = createCard(placement, index);
        card.group.position.y = cardOffset(placement, index);
        cards.push(card);
        group.add(card.group);
      }
      root.add(group);
      stack = { group, cards, placed: false };
      stacks.set(placement, stack);
    }
    return stack;
  };

  const render = (): void => {
    for (const placement of TOAST_PLACEMENTS) {
      const visible = queue.visible(placement);
      if (!visible.length && !stacks.has(placement)) continue;
      const stack = stackFor(placement);
      stack.cards.forEach((card, index) => {
        const entry = visible[index];
        card.group.visible = Boolean(entry);
        card.id = entry?.toast.id ?? null;
        card.plate.userData.toastId = card.id;
        card.close.userData.toastId = card.id;
        if (!entry) return;
        const text = toastCardText(entry);
        if (card.text.userData.labelText !== text) updateScalableLabel(card.text, text);
        card.stripe.material.color.set(entry.toast.color);
      });
      stack.group.visible = visible.length > 0;
      stack.group.userData.paneId = visible[0]?.toast.paneId ?? null;
    }
  };

  const place = (
    placement: ToastPlacement,
    stack: Stack,
    deltaSeconds: number,
    anchors: ToastAnchors,
  ): void => {
    const group = stack.group;
    if (placement === 'hud' || placement === 'pane') {
      const anchor =
        placement === 'hud'
          ? anchors.hud && { object: anchors.hud, top: HUD_OFFSET }
          : anchors.pane(group.userData.paneId as string | null);
      // Without its anchor (HUD not built, pane closed) a stack falls back to the top of the view.
      if (!anchor) {
        placeInView('top', stack, deltaSeconds, anchors.camera);
        return;
      }
      anchor.object.updateWorldMatrix(true, false);
      anchor.object.getWorldQuaternion(group.quaternion);
      anchor.object.getWorldScale(anchorScale);
      const lift = placement === 'hud' ? anchor.top : anchor.top + PANE_GAP + TOAST_CARD_HEIGHT / 2;
      group.position.copy(anchor.object.localToWorld(offset.set(0, lift, 0.02)));
      group.scale.setScalar(anchorScale.x * (placement === 'hud' ? HUD_SCALE : 1));
      stack.placed = true;
      return;
    }
    placeInView(placement, stack, deltaSeconds, anchors.camera);
  };

  const placeInView = (
    placement: ToastPlacement,
    stack: Stack,
    deltaSeconds: number,
    camera: THREE.Camera,
  ): void => {
    const group = stack.group;
    const lift = VIEW_OFFSET[placement as keyof typeof VIEW_OFFSET] ?? VIEW_OFFSET.top;
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(head);
    camera.getWorldQuaternion(headQuaternion);
    target.copy(head).add(offset.set(0, lift, -VIEW_DISTANCE).applyQuaternion(headQuaternion));
    group.scale.setScalar(1);
    if (!stack.placed) {
      group.position.copy(target);
      group.quaternion.copy(headQuaternion);
      stack.placed = true;
      return;
    }
    const follow = 1 - Math.exp(-FOLLOW_RATE * Math.max(0, deltaSeconds));
    group.position.lerp(target, follow);
    group.quaternion.slerp(headQuaternion, follow);
  };

  return {
    root,
    apply(envelope, now) {
      if (disposed) return false;
      const changed = queue.apply(envelope, now);
      if (changed) render();
      return changed;
    },
    dismiss(id) {
      if (disposed) return false;
      const changed = queue.dismiss(id);
      if (changed) render();
      return changed;
    },
    update(now, deltaSeconds, anchors) {
      if (disposed) return;
      if (queue.expire(now)) render();
      for (const [placement, stack] of stacks) {
        if (!stack.group.visible) {
          stack.placed = false;
          continue;
        }
        place(placement, stack, deltaSeconds, anchors);
      }
    },
    shown() {
      const result = Object.fromEntries(
        TOAST_PLACEMENTS.map((placement) => [placement, [] as string[]]),
      ) as Record<ToastPlacement, string[]>;
      for (const [placement, stack] of stacks)
        for (const card of stack.cards)
          if (card.group.visible && card.id) result[placement].push(card.id);
      return result;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeOwned(root);
      root.clear();
    },
  };
}
