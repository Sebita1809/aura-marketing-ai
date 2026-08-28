import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { hasAcceptedCurrentVersion, LEGAL_CHANNEL_WEB, LEGAL_DOCUMENTS } from '../lib/legalDocuments';

const LEGAL_DOCUMENT_LIST = Object.values(LEGAL_DOCUMENTS);

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  // Id de usuario para el que `profile` ya se buscó (con éxito o no). Se
  // compara contra `user?.id` para derivar profileLoading en el mismo render
  // en que `user` cambia -- ver comentario de profileLoading más abajo.
  const [profileFetchedFor, setProfileFetchedFor] = useState(null);
  const [loading, setLoading] = useState(true);
  // Derivado, no un state separado: si fuera un state actualizado por el
  // useEffect de abajo, habría un render intermedio -- entre que `user`
  // cambia (ej. login) y que el efecto corre -- donde profileLoading todavía
  // tendría el valor viejo (false, de "no logueado") mientras `profile` sigue
  // en null. En ese render, ProtectedRoute leería "perfil cargado sin rol" y
  // redirigiría de más (flash de ConnectionsPage/"Hola, Usuario" al loguearse
  // como admin). Al derivarlo de profileFetchedFor vs user.id, queda
  // sincronizado en el mismo render en que user cambia, sin ventana de carrera.
  const profileLoading = loading || (!!user?.id && profileFetchedFor !== user.id);
  // Un booleano por slug de documento (privacy_policy, terms_conditions),
  // canal web. legal-documents-acceptance: aceptación combinada en un solo
  // paso (design decision), pero registrada por documento en Supabase.
  const [legalStatus, setLegalStatus] = useState({});
  // Mismo patrón que profileFetchedFor, mismo motivo (evitar la ventana de
  // carrera de un state de loading separado).
  const [legalStatusFetchedFor, setLegalStatusFetchedFor] = useState(null);
  const legalLoading = loading || (!!user?.id && legalStatusFetchedFor !== user.id);
  const legalAccepted = LEGAL_DOCUMENT_LIST.every((doc) => legalStatus[doc.slug]);

  // Obtener el perfil (rol) del usuario autenticado
  useEffect(() => {
    // Esperar a que la sesión termine de resolverse (getSession() es async).
    if (loading) return;

    if (!user?.id) {
      setProfile(null);
      setProfileFetchedFor(null);
      return;
    }

    const fetchProfile = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('role, company, full_name, status, avatar_key')
        .eq('id', user.id)
        .single();

      if (data) setProfile(data);
      setProfileFetchedFor(user.id);
    };

    fetchProfile();
  }, [user?.id, loading]);

  // Aceptación de documentos legales, canal web (legal-documents-acceptance).
  // Mismo criterio de timing que el efecto de arriba: espera a que `loading`
  // resuelva antes de decidir "no hay nada que buscar", para no marcar
  // legalLoading=false de más durante el flash de una sesión que en realidad
  // sigue resolviéndose.
  useEffect(() => {
    if (loading) return;

    if (!user?.id) {
      setLegalStatus({});
      setLegalStatusFetchedFor(null);
      return;
    }

    const fetchLegalAcceptance = async () => {
      const { data } = await supabase
        .from('legal_acceptances')
        .select('document, version')
        .eq('user_id', user.id)
        .eq('channel', LEGAL_CHANNEL_WEB)
        .in('document', LEGAL_DOCUMENT_LIST.map((doc) => doc.slug));

      const rows = data || [];
      const status = {};
      for (const doc of LEGAL_DOCUMENT_LIST) {
        const row = rows.find((r) => r.document === doc.slug);
        status[doc.slug] = hasAcceptedCurrentVersion(row, doc.version);
      }
      setLegalStatus(status);
      setLegalStatusFetchedFor(user.id);
    };

    fetchLegalAcceptance();
  }, [user?.id, loading]);

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
      })
      .catch((err) => {
        console.error('Error al obtener sesión:', err);
        setUser(null);
        setSession(null);
      })
      .finally(() => {
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription?.unsubscribe();
  }, []);

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  // Merge local optimista sobre `profile` tras un update propio ya
  // confirmado por el servidor (ProfilePage) -- evita que el resto de la app
  // (headers, Sidebar) siga mostrando el valor viejo hasta el próximo
  // refetch de sesión. No dispara ningún fetch nuevo, no reemplaza loadRow
  // de ProfilePage (esa sigue siendo la fuente de verdad para esa página).
  const updateProfile = (partial) => {
    setProfile((p) => (p ? { ...p, ...partial } : p));
  };

  // Acepta TODOS los documentos legales de un saque (decisión combinada,
  // legal-documents-acceptance): un RPC por documento, cada uno un upsert
  // independiente en `legal_acceptances`. Si el segundo falla tras el primero
  // ya haber quedado guardado, no es un problema -- el gate vuelve a
  // mostrarse (legalAccepted sigue false) y el usuario reintenta; el primer
  // documento no se re-envía al servidor en vano porque el RPC es upsert.
  const acceptLegalDocuments = async () => {
    for (const doc of LEGAL_DOCUMENT_LIST) {
      const { data, error } = await supabase.rpc('accept_legal_document', {
        p_document: doc.slug,
        p_channel: LEGAL_CHANNEL_WEB,
        p_version: doc.version,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'No se pudo registrar la aceptación.');
    }
    setLegalStatus((prev) => {
      const next = { ...prev };
      for (const doc of LEGAL_DOCUMENT_LIST) next[doc.slug] = true;
      return next;
    });
  };

  return (
    <AuthContext.Provider value={{
      user, session, profile, loading, profileLoading, login, logout, updateProfile,
      legalStatus, legalLoading, legalAccepted, acceptLegalDocuments,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de un AuthProvider');
  return context;
}

export default AuthContext;
