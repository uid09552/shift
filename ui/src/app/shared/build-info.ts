/**
 * The UI's own build: version, commit and date, replaced into the bundle at
 * build time. GitLab CI passes them as Docker build arguments, and
 * deploy/Dockerfile.ui hands them to `ng build --define`. `ng serve`, tests
 * and a plain local build define nothing and report "dev".
 *
 * The typeof guard is what makes an undefined constant safe to read: with
 * `--define` the whole identifier is replaced by the string literal.
 */
declare const APP_VERSION: string;
declare const GIT_COMMIT: string;
declare const BUILD_DATE: string;

export interface BuildInfo {
  version: string;
  /** Full commit SHA; empty when unknown. */
  commit: string;
  /** ISO 8601; empty when unknown. */
  build_date: string;
}

export const UI_BUILD: BuildInfo = {
  version: (typeof APP_VERSION !== 'undefined' && APP_VERSION) || 'dev',
  commit: (typeof GIT_COMMIT !== 'undefined' && GIT_COMMIT) || '',
  build_date: (typeof BUILD_DATE !== 'undefined' && BUILD_DATE) || '',
};
