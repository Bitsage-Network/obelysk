import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",

  // Performance monitoring
  tracesSampleRate: 0.1, // 10% of transactions
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  // Filter noise
  ignoreErrors: [
    "ResizeObserver loop",
    "Non-Error promise rejection",
    "Loading chunk",
    "Network request failed",
    "AbortError",
    "TypeError: Failed to fetch",
    "TypeError: Load failed",
    "TypeError: cancelled",
  ],

  beforeSend(event) {
    // Strip wallet addresses from breadcrumbs
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((bc) => ({
        ...bc,
        message: bc.message?.replace(/0x[a-fA-F0-9]{40,66}/g, "0x[REDACTED]"),
      }));
    }
    return event;
  },
});
