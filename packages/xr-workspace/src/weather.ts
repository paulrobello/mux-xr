/**
 * Dependency-free weather data model and provider, shared by the host service and the browser
 * client: no `three` import, so the Node host service can load this subpath.
 */

export * from './weather-data';
export * from './weather-provider';
