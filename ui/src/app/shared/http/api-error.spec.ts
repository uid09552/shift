import { HttpErrorResponse } from '@angular/common/http';

import { apiErrorMessage } from './api-error';

describe('apiErrorMessage', () => {
  const i18n = { t: (key: string) => `t:${key}` };

  it("passes the server's reason through", () => {
    const err = new HttpErrorResponse({ status: 409, error: { error: 'Month 2026-10 is locked' } });
    expect(apiErrorMessage(err, 'common.deleteFailed', i18n)).toBe('Month 2026-10 is locked');
  });

  it('says the server could not be reached when the request never got there', () => {
    const err = new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') });
    expect(apiErrorMessage(err, 'common.deleteFailed', i18n)).toBe('t:common.offline');
  });

  it('falls back when the server gave no reason', () => {
    const err = new HttpErrorResponse({ status: 500, error: 'Internal Server Error' });
    expect(apiErrorMessage(err, 'common.deleteFailed', i18n)).toBe('t:common.deleteFailed');
  });

  it('ignores a blank reason', () => {
    const err = new HttpErrorResponse({ status: 400, error: { error: '  ' } });
    expect(apiErrorMessage(err, 'common.importFailed', i18n)).toBe('t:common.importFailed');
  });

  it('falls back for something that is not an HTTP error', () => {
    expect(apiErrorMessage(new Error('boom'), 'common.loadFailed', i18n)).toBe('t:common.loadFailed');
  });
});
