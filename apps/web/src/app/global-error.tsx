"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body style={{ background: "#0a0a0f", color: "#fff", fontFamily: "system-ui", padding: "2rem" }}>
        <h2>Something went wrong</h2>
        <p style={{ color: "#888" }}>An unexpected error occurred. Our team has been notified.</p>
        <button
          onClick={reset}
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            background: "#1a1a2e",
            color: "#fff",
            border: "1px solid #333",
            borderRadius: "0.5rem",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
