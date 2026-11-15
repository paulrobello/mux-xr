import { describe, expect, it } from 'vitest';
import { HOST_SERVICE_PORT, hostServicePort, hostServiceUrl } from '../src/host-service';

describe('host service URL', () => {
  it('defaults to port 4242 and derives the scheme from the page', () => {
    expect(
      hostServiceUrl('/host-stats', {
        href: 'https://10.0.0.5:4240/app/?x=1#y',
        protocol: 'https:',
      }),
    ).toBe('wss://10.0.0.5:4242/host-stats');
    expect(
      hostServiceUrl('/host-stats', { href: 'http://localhost:4240/', protocol: 'http:' }),
    ).toBe('ws://localhost:4242/host-stats');
  });

  it('honours a host-port query override', () => {
    expect(
      hostServiceUrl('/weather', {
        href: 'http://localhost:4240/app/?host-port=5000',
        protocol: 'http:',
      }),
    ).toBe('ws://localhost:5000/weather');
    expect(hostServicePort({ href: 'http://localhost:4240/?host-port=80' })).toBe(80);
    expect(hostServicePort({ href: 'http://localhost:4240/?host-port=65535' })).toBe(65535);
  });

  it('ignores invalid host-port overrides', () => {
    expect(hostServicePort({ href: 'http://localhost:4240/' })).toBe(4242);
    expect(hostServicePort({ href: 'http://localhost:4240/?host-port=0' })).toBe(4242);
    expect(hostServicePort({ href: 'http://localhost:4240/?host-port=65536' })).toBe(4242);
    expect(hostServicePort({ href: 'http://localhost:4240/?host-port=abc' })).toBe(4242);
    expect(hostServicePort({ href: 'http://localhost:4240/?host-port=12.5' })).toBe(4242);
  });

  it('exports the deployed port', () => {
    expect(HOST_SERVICE_PORT).toBe(4242);
  });
});
