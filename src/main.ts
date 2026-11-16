import './styles.css';
import { createApp } from './app';
import { classifyServerParam } from './server-param';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Application mount is missing');
const app = createApp(root);

const params = new URLSearchParams(location.search);
const serverParam = params.get('server');
const savedEndpoint = app.savedEndpoint();
if (params.get('demo') === '1') app.startDemo();
else if (serverParam) {
  if (classifyServerParam(serverParam, location.host, savedEndpoint) === 'connect')
    void app.connect(serverParam);
  else
    app.proposeEndpoint(
      serverParam,
      'This link names a different streamer. Check the endpoint and press Connect.',
    );
} else if (savedEndpoint) void app.connect(savedEndpoint);

window.addEventListener('pagehide', () => app.dispose(), { once: true });
