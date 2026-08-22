import { useEffect, useState } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export default function MetaOAuthCallback() {
  const [status, setStatus] = useState('Procesando autorización...');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    if (error) {
      setStatus(`Error: ${error}`);
      setTimeout(() => {
        window.location.href = '/app/connections?oauth=error&message=' + encodeURIComponent(error);
      }, 2000);
      return;
    }

    if (!code || !state) {
      setStatus('Faltan parámetros de autorización');
      setTimeout(() => {
        window.location.href = '/app/connections?oauth=error&message=Faltan+par%C3%A1metros';
      }, 2000);
      return;
    }

    const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/auth-meta-callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    window.location.href = edgeFunctionUrl;
  }, []);

  return (
    <div className="min-h-screen bg-surface-dim text-on-surface flex items-center justify-center">
      <div className="glass-card p-8 rounded-2xl text-center">
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
          <svg className="animate-spin h-6 w-6 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <p className="font-body-md text-on-surface-variant">{status}</p>
      </div>
    </div>
  );
}
