import { isDevMode } from '@angular/core';
import { getWebInstrumentations, initializeFaro } from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

import { version } from '../package.json';

// Grafana Faro: errors, Web Vitals, sessions and traces of the browser app.
// Imported first in main.ts so it is running before Angular bootstraps.
// The collector origin must be in the gateway's CSP `connect-src`.
initializeFaro({
  url: 'https://faro-collector-prod-eu-west-2.grafana.net/collect/710bf2043c53415ed1b10a412367a021',
  app: {
    name: 'shift-ui',
    version,
    environment: isDevMode() ? 'development' : 'production',
  },
  ignoreErrors: [
    // Layout quirks — harmless, not real errors
    /^ResizeObserver loop limit exceeded$/,
    /^ResizeObserver loop completed with undelivered notifications$/,
    // Cross-origin scripts with no useful stack
    /^Script error\.$/,
    // Browser extension interference
    /chrome-extension:\/\//,
    /moz-extension:\/\//,
  ],
  instrumentations: [...getWebInstrumentations(), new TracingInstrumentation()],
});
