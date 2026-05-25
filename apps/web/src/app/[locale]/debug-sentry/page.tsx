'use client';

export default function DebugSentryPage() {
  return (
    <main style={{ padding: 32, fontFamily: 'system-ui' }}>
      <h1>Sentry test page</h1>
      <p>Click the button to throw a client-side error.</p>
      <button
        type="button"
        style={{
          padding: '8px 16px',
          background: '#dc2626',
          color: 'white',
          border: 0,
          borderRadius: 4,
          cursor: 'pointer',
        }}
        onClick={() => {
          throw new Error('Sentry test error from @qtm/web (client)');
        }}
      >
        Throw client error
      </button>
    </main>
  );
}
