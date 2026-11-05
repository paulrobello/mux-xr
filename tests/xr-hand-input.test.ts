import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type HandInputState, updateHandInput } from '../src/xr/hand-input';

type HandFixture = THREE.Group & { joints: Record<string, THREE.Group> };

function handFixture(): HandFixture {
  const hand = new THREE.Group() as HandFixture;
  hand.visible = true;
  hand.joints = {};
  for (const name of ['wrist', 'thumb-tip', 'index-finger-tip', 'middle-finger-tip']) {
    const joint = new THREE.Group();
    joint.visible = true;
    hand.joints[name] = joint;
    hand.add(joint);
  }
  openHand(hand);
  return hand;
}

function openHand(hand: HandFixture): void {
  hand.joints['thumb-tip'].position.set(0, 0, 0);
  hand.joints['index-finger-tip'].position.set(0.08, 0, 0);
  hand.joints['middle-finger-tip'].position.set(0.08, 0.02, 0);
}

function middlePinch(hand: HandFixture): void {
  hand.joints['middle-finger-tip'].position.set(0.01, 0, 0);
}

function indexPinch(hand: HandFixture): void {
  hand.joints['index-finger-tip'].position.set(0.01, 0, 0);
}

function state(): HandInputState {
  return { pinching: false, neutral: false, tracked: false };
}

describe('hand input gesture lifecycle', () => {
  it('requires every root joint and cancels tracking immediately when one disappears', () => {
    const hand = handFixture();
    const input = state();
    expect(updateHandInput(hand, input).tracked).toBe(true);
    hand.joints['middle-finger-tip'].visible = false;
    const lost = updateHandInput(hand, input);
    expect(lost.tracked).toBe(false);
    expect(input.pinching).toBe(false);
    expect(input.neutral).toBe(false);
  });

  it('does not activate on a held pinch after recovery, then rearms after opening', () => {
    const hand = handFixture();
    const input = state();
    updateHandInput(hand, input);
    middlePinch(hand);
    hand.joints['index-finger-tip'].position.set(0.01, 0, 0);
    hand.visible = false;
    updateHandInput(hand, input);
    hand.visible = true;
    expect(updateHandInput(hand, input).started).toBe(false);
    openHand(hand);
    expect(updateHandInput(hand, input).tracked).toBe(true);
    expect(input.neutral).toBe(true);
    middlePinch(hand);
    expect(updateHandInput(hand, input).started).toBe(true);
  });

  it('uses thumb-middle pinch while requiring index to remain tracked and open', () => {
    const hand = handFixture();
    const input = state();
    updateHandInput(hand, input);
    middlePinch(hand);
    const pinch = updateHandInput(hand, input);
    expect(pinch.started).toBe(true);
    expect(pinch.pinching).toBe(true);
    hand.joints['index-finger-tip'].visible = false;
    expect(updateHandInput(hand, input).tracked).toBe(false);
  });

  it('does not start a middle grab while index-thumb selection is pinched', () => {
    const hand = handFixture();
    const input = state();
    updateHandInput(hand, input);
    indexPinch(hand);
    middlePinch(hand);
    const result = updateHandInput(hand, input);
    expect(result.started).toBe(false);
    expect(result.pinching).toBe(false);
    expect(input.neutral).toBe(true);
  });

  it('keeps an existing middle grab active when index-thumb selection closes', () => {
    const hand = handFixture();
    const input = state();
    updateHandInput(hand, input);
    middlePinch(hand);
    expect(updateHandInput(hand, input).started).toBe(true);
    indexPinch(hand);
    const result = updateHandInput(hand, input);
    expect(result.pinching).toBe(true);
    expect(result.started).toBe(false);
    expect(result.ended).toBe(false);
  });
});
