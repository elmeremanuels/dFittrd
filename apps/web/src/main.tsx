import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import './index.css';
import { isEmbedPath } from './embed/path';

const root = document.getElementById('root')!;

// Two entries: the standalone embed inside a merchant page (docs/STANDALONE.md) loads only its
// own code; the app (store hydration, service worker) loads only outside /embed.
if (isEmbedPath(location.pathname)) void import('./embed/mount').then((m) => m.mountEmbed(root));
else void import('./appMain').then((m) => m.mountApp(root));
