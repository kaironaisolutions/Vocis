import * as Sentry from '@sentry/react-native';

/**
 * Initialize Sentry crash reporting.
 *
 * Privacy policy compliance:
 * - No PII is collected or sent to Sentry
 * - beforeSend hook strips any potentially sensitive data
 * - User inventory data is never included in error reports
 * - API keys are never logged
 *
 * Configure SENTRY_DSN in your environment before production build.
 */
export function initCrashReporting() {
  // Only initialize if DSN is configured
  // DSN should be set via EAS build secrets, never hardcoded
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

  if (!dsn) {
    console.log('[Sentry] No DSN configured, crash reporting disabled.');
    return;
  }

  Sentry.init({
    dsn,
    // Only send in production
    enabled: !__DEV__,
    // Sample rate for performance monitoring
    tracesSampleRate: 0.2,
    // Strip PII from error reports
    beforeSend(event: Sentry.ErrorEvent) {
      return sanitizeEvent(event) as Sentry.ErrorEvent;
    },
    beforeBreadcrumb(breadcrumb) {
      // Don't log network request details (could contain API keys in URLs)
      if (breadcrumb.category === 'xhr' || breadcrumb.category === 'fetch') {
        if (breadcrumb.data?.url) {
          // Strip query parameters which may contain API keys
          const url = new URL(breadcrumb.data.url);
          url.search = '';
          breadcrumb.data.url = url.toString();
        }
      }
      return breadcrumb;
    },
  });
}

/**
 * Strip any potentially sensitive data from Sentry events.
 */
function sanitizeEvent(event: Sentry.Event): Sentry.Event {
  // Remove user info if present
  if (event.user) {
    delete event.user.email;
    delete event.user.username;
    delete event.user.ip_address;
  }

  // Scrub API keys from exception messages
  if (event.exception?.values) {
    for (const exception of event.exception.values) {
      if (exception.value) {
        exception.value = scrubSecrets(exception.value);
      }
    }
  }

  // Scrub breadcrumb messages
  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (crumb.message) {
        crumb.message = scrubSecrets(crumb.message);
      }
    }
  }

  return event;
}

/**
 * Remove patterns that look like API keys or secrets from strings.
 */
function scrubSecrets(str: string): string {
  // Scrub anything that looks like an API key (20+ alphanumeric chars)
  return str.replace(/[a-zA-Z0-9_-]{20,}/g, '[REDACTED]');
}

/**
 * Report a non-fatal error to Sentry.
 */
export function reportError(error: Error, context?: Record<string, string>) {
  if (context) {
    Sentry.setContext('custom', context);
  }
  Sentry.captureException(error);
}
