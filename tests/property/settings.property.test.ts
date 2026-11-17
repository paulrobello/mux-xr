import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BACKGROUND_MODES } from '../../src/contracts';
import { validPose } from '../../src/pose-validation';
import { DEFAULT_SETTINGS, sameSettings, validateSettings } from '../../src/settings/store';
import { AGENT_ROWS_CHOICES, AGENTS_SORTS } from '../../src/workspace/agent-roster';
import { propertyOptions } from './fc-options';

const COLOR_MODES = ['comfort', 'original', 'monochrome'] as const;
const ARRANGEMENTS = ['row', 'grid', 'arc', 'sphere'] as const;

/**
 * Every field passes the same checks the defaults satisfy: scalar types, enum membership and
 * ranges. Nested objects (filtering, windowPreferences, buttonMap) are covered by the fixed
 * point property instead of duplicating their validators here.
 */
const everyFieldIsValid = (settings: Record<string, unknown>): boolean => {
  for (const [field, value] of Object.entries(settings)) {
    switch (field) {
      case 'version':
        if (value !== 1) return false;
        break;
      case 'endpoint':
      case 'agentRowsCustom':
        if (typeof value !== 'string') return false;
        break;
      case 'gazeInput':
      case 'keyboardBackground':
      case 'uiSounds':
        if (typeof value !== 'boolean') return false;
        break;
      case 'keyboardCurvature':
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
          return false;
        }
        break;
      case 'background':
        if (!(BACKGROUND_MODES as readonly unknown[]).includes(value)) return false;
        break;
      case 'colorMode':
        if (!(COLOR_MODES as readonly unknown[]).includes(value)) return false;
        break;
      case 'arrangement':
        if (!(ARRANGEMENTS as readonly unknown[]).includes(value)) return false;
        break;
      case 'agentRows':
        if (!(AGENT_ROWS_CHOICES as readonly unknown[]).includes(value)) return false;
        break;
      case 'agentsSort':
        if (!(AGENTS_SORTS as readonly unknown[]).includes(value)) return false;
        break;
      case 'agentBoardMaxRows':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 3 || value > 12) {
          return false;
        }
        break;
      case 'handColor':
      case 'armColor':
      case 'accentColor':
      case 'environmentAccentColor':
        if (value !== '' && !/^#[0-9a-f]{6}$/i.test(String(value))) return false;
        break;
      case 'weatherZip':
        if (value !== '' && !/^\d{5}$/.test(String(value))) return false;
        break;
      default:
        break;
    }
  }
  return true;
};

/** A value of the same shape a pose store reads back, over realistic numeric ranges. */
const nearPoses = fc.record({
  position: fc.tuple(
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
  ),
  quaternion: fc.tuple(
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
  ),
  scale: fc.double({ noNaN: true, noDefaultInfinity: true }),
});

describe('settings validator properties', () => {
  it('validateSettings never throws and returns canonical settings for any JSON value', async () => {
    await fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        let result: unknown;
        expect(() => {
          result = validateSettings(value);
        }).not.toThrow();
        const settings = result as Record<string, unknown>;
        expect(Object.keys(DEFAULT_SETTINGS).every((key) => key in settings)).toBe(true);
        expect(everyFieldIsValid(settings)).toBe(true);
        expect(
          sameSettings(validateSettings(settings), settings as unknown as typeof DEFAULT_SETTINGS),
        ).toBe(true);
      }),
      propertyOptions(),
    );
  });

  it('validPose always answers with a boolean, finite parts whenever it answers true', async () => {
    await fc.assert(
      fc.property(fc.oneof(fc.jsonValue(), nearPoses), (value) => {
        let answer: unknown;
        expect(() => {
          answer = validPose(value);
        }).not.toThrow();
        expect(typeof answer).toBe('boolean');
        if (answer === true) {
          const pose = value as { position: number[]; quaternion: number[]; scale: number };
          for (const part of [...pose.position, ...pose.quaternion, pose.scale]) {
            expect(Number.isFinite(part)).toBe(true);
          }
        }
      }),
      propertyOptions(),
    );
  });
});
