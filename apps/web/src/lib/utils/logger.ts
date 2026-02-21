/**
 * Production-safe logger utility.
 *
 * Suppresses log and warn output in production builds to prevent
 * leaking sensitive cryptographic data (keys, commitments, etc.)
 * to the browser console. Errors are always logged.
 */

const isDev = process.env.NODE_ENV === 'development';

export const logger = {
  log: (...args: unknown[]) => {
    if (isDev) console.log(...args);
  },
  warn: (...args: unknown[]) => {
    if (isDev) console.warn(...args);
  },
  error: (...args: unknown[]) => console.error(...args),
};
