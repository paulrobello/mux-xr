import {
  createWeatherWidget as createWidget,
  type WeatherFetcher,
  type WeatherWidget,
  type WeatherWidgetOptions,
} from '@par/xr-workspace';
import type * as THREE from 'three';

/** The weather widget with this app's ZIP hint; `fetchWeather` is the paired host client. */
export function createWeatherWidget(
  envMap: THREE.Texture | null,
  options: WeatherWidgetOptions & { fetchWeather: WeatherFetcher },
): WeatherWidget {
  return createWidget(envMap, { zipHint: 'Settings › World › Weather ZIP', ...options });
}
