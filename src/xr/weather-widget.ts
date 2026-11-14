import {
  createWeatherWidget as createWidget,
  type WeatherWidget,
  type WeatherWidgetOptions,
} from '@par/xr-workspace/internal/weather-widget';
import type * as THREE from 'three';
import { createDefaultWeatherFetcher } from '../host-weather';

export * from '@par/xr-workspace/internal/weather-widget';

export function createWeatherWidget(
  envMap: THREE.Texture | null = null,
  options: WeatherWidgetOptions = {},
): WeatherWidget {
  return createWidget(envMap, {
    zipHint: 'Settings › World › Weather ZIP',
    ...options,
    fetchWeather: options.fetchWeather ?? createDefaultWeatherFetcher(),
  });
}
