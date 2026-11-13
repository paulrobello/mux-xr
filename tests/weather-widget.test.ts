import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', () => ({
  Text: class MockText extends THREE.Mesh {
    sync(callback?: () => void): void {
      callback?.();
    }
    dispose(): void {
      /* test double */
    }
  },
  configureTextBuilder: vi.fn(),
}));

import type { WeatherFetcher, WeatherReport, WeatherResult } from '../src/host-weather';
import {
  createWeatherWidget,
  formatDayTemps,
  formatUpdated,
  weatherIconKind,
  weatherView,
} from '../src/xr/weather-widget';

const REPORT: WeatherReport = {
  zip: '95814',
  place: 'Sacramento',
  region: 'CA',
  now: {
    tempF: 71,
    summary: 'Partly Sunny',
    isDay: true,
    windMph: 3,
    windDir: 'SSW',
    humidity: 51,
    precip: 1,
  },
  days: [
    { name: 'Today', highF: 72, lowF: 53, summary: 'Mostly Sunny', precip: 17 },
    { name: 'Fri', highF: 61, lowF: 47, summary: 'Showers And Thunderstorms', precip: 98 },
  ],
  fetchedAt: '2026-11-13T00:00:00.000Z',
};
const AT = Date.parse(REPORT.fetchedAt);

const text = (root: THREE.Object3D, name: string): unknown =>
  root.getObjectByName(name)?.userData.labelText;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('weather view', () => {
  it('maps NWS wording onto icons, the most severe word first', () => {
    expect(weatherIconKind('Showers And Thunderstorms')).toBe('thunder');
    expect(weatherIconKind('Rain And Snow')).toBe('snow');
    expect(weatherIconKind('Slight Chance Light Rain')).toBe('rain');
    expect(weatherIconKind('Patchy Fog')).toBe('fog');
    expect(weatherIconKind('Mostly Sunny')).toBe('partly');
    expect(weatherIconKind('Mostly Cloudy')).toBe('cloudy');
    expect(weatherIconKind('Clear')).toBe('clear');
    expect(weatherIconKind('')).toBe('cloudy');
  });

  it('formats a report and every quiet state', () => {
    const view = weatherView({ kind: 'report', report: REPORT }, AT + 5 * 60_000);
    expect(view).toMatchObject({
      title: 'Sacramento, CA',
      temp: '71°',
      summary: 'Partly Sunny',
      detail: 'Wind 3 mph SSW · Humidity 51% · Precip 1%\nUpdated 5 min ago',
      icon: 'partly',
    });
    expect(weatherView({ kind: 'no-zip' }, AT).summary).toBe('No ZIP code set');
    expect(weatherView({ kind: 'unknown-zip', zip: '00000' }, AT).summary).toBe(
      'ZIP code not found',
    );
    expect(weatherView({ kind: 'failed', zip: '95814', code: 'no-secret' }, AT).detail).toBe(
      'Pair the host clipboard in Settings',
    );
    expect(formatUpdated('bad', AT)).toBe('');
    expect(formatUpdated(REPORT.fetchedAt, AT + 2 * 3_600_000)).toBe('over an hour ago');
    expect(formatDayTemps({ name: 'Tonight', highF: null, lowF: 50, summary: '', precip: 0 })).toBe(
      'Low 50°',
    );
  });
});

describe('weather widget', () => {
  it('asks for a ZIP, fetches once it has one and renders the forecast', async () => {
    const fetchWeather = vi.fn<WeatherFetcher>(
      async (): Promise<WeatherResult> => ({ ok: true, status: { state: 'ok', report: REPORT } }),
    );
    const widget = createWeatherWidget(null, { fetchWeather, pageHidden: () => false });
    const { root } = widget;
    expect(text(root, 'weather-summary')).toBe('No ZIP code set');
    widget.update(Date.now());
    expect(fetchWeather).not.toHaveBeenCalled();
    widget.setWeatherZip?.('95814');
    expect(text(root, 'weather-summary')).toBe('Checking the forecast…');
    await flush();
    expect(fetchWeather).toHaveBeenCalledWith('95814');
    expect(text(root, 'weather-title')).toBe('Sacramento, CA');
    expect(text(root, 'weather-temp')).toBe('71°');
    expect(text(root, 'weather-day-1-temps')).toBe('61° / 47°');
    expect(text(root, 'weather-day-1-precip')).toBe('98% precip');
    expect(root.getObjectByName('weather-day-2-plate')?.visible).toBe(false);
    expect(root.getObjectByName('weather-icon-partly')).toBeTruthy();
    expect(
      root.getObjectByName('weather-day-1-icon')?.getObjectByName('weather-icon-thunder'),
    ).toBeTruthy();
    // Every drawn part stays grabbable and tagged as this widget.
    root.traverse((object) => {
      expect(object.userData.widgetKind).toBe('weather');
      expect(object.userData.inputAction).toBeTruthy();
    });
    widget.update(Date.now() + 1000);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    widget.dispose();
  });

  it('keeps a good report through an outage and retries sooner', async () => {
    let result: WeatherResult = { ok: true, status: { state: 'ok', report: REPORT } };
    const fetchWeather = vi.fn<WeatherFetcher>(async () => result);
    const widget = createWeatherWidget(null, {
      fetchWeather,
      pageHidden: () => false,
      pollMs: 600_000,
      retryMs: 60_000,
    });
    widget.setWeatherZip?.('95814');
    await flush();
    result = { ok: false, code: 'timeout' };
    widget.update(Date.now() + 600_001);
    await flush();
    expect(fetchWeather).toHaveBeenCalledTimes(2);
    expect(text(widget.root, 'weather-temp')).toBe('71°');
    widget.update(Date.now() + 60_001);
    await flush();
    expect(fetchWeather).toHaveBeenCalledTimes(3);
    widget.dispose();
  });

  it('shows unknown ZIPs without polling them again and clears on an invalid ZIP', async () => {
    const fetchWeather = vi.fn<WeatherFetcher>(async () => ({
      ok: true,
      status: { state: 'unknown-zip' },
    }));
    const widget = createWeatherWidget(null, { fetchWeather, pageHidden: () => false });
    widget.setWeatherZip?.('00000');
    await flush();
    expect(text(widget.root, 'weather-summary')).toBe('ZIP code not found');
    widget.update(Date.now() + 10 * 3_600_000);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    widget.setWeatherZip?.('nope');
    expect(text(widget.root, 'weather-summary')).toBe('No ZIP code set');
    widget.dispose();
  });

  it('ignores an answer for a ZIP that was replaced while in flight', async () => {
    let release: (value: WeatherResult) => void = () => undefined;
    const fetchWeather = vi
      .fn<WeatherFetcher>()
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
      .mockResolvedValue({ ok: true, status: { state: 'unknown-zip' } });
    const widget = createWeatherWidget(null, { fetchWeather, pageHidden: () => false });
    widget.setWeatherZip?.('95814');
    widget.setWeatherZip?.('10001');
    await flush();
    release({ ok: true, status: { state: 'ok', report: REPORT } });
    await flush();
    expect(text(widget.root, 'weather-summary')).toBe('ZIP code not found');
    widget.dispose();
  });

  it('animates the main icon and disposes the shared icon kit once', async () => {
    const fetchWeather = vi.fn<WeatherFetcher>(async () => ({
      ok: true,
      status: {
        state: 'ok',
        report: { ...REPORT, now: { ...REPORT.now, summary: 'Sunny' } },
      },
    }));
    const widget = createWeatherWidget(null, { fetchWeather, pageHidden: () => false });
    widget.setWeatherZip?.('95814');
    await flush();
    const icon = widget.root.getObjectByName('weather-icon-clear');
    if (!icon) throw new Error('clear icon missing');
    const rays = icon.children.find((child) => child instanceof THREE.Group) as THREE.Group;
    widget.update(1000);
    const before = rays.rotation.z;
    widget.update(3000);
    expect(rays.rotation.z).not.toBe(before);
    const disposed = vi.fn();
    (icon.children[0] as THREE.Mesh).geometry.addEventListener('dispose', disposed);
    widget.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(widget.root.children).toHaveLength(0);
  });
});
