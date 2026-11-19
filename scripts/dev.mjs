import { prepareWeb } from './prepare-web.mjs';
await prepareWeb();
process.argv.push('--next');
await import('./server.mjs');
