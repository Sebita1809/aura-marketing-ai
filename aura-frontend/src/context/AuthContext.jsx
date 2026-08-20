import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // Arranca en true: hasta que la sesión (loading) resuelva, no sabemos
  // todavía si hay o no un usuario cuyo perfil haya que buscar.
  const [profileLoading, setProfileLoading] = useState(true);

  // Obtener el perfil (rol) del usuario autenticado
  useEffect(() => {
    // Esperar a que la sesión termine de resolverse (getSession() es async).
    // Si este efecto decidiera "no hay perfil que buscar" mientras `loading`
    // todavía es true, marcaría profileLoading=false para un `user` que en
    // realidad todavía no se determinó (sigue en null momentáneamente) — y
    // cuando la sesión existente resuelva un instante después, profile
    // seguirá en null pero profileLoading ya habrá quedado en false, dejando
    // una ventana de render donde ProtectedRoute cree que el perfil terminó
    // de cargar sin rol y redirija de más (el flash de ConnectionsPage al
    // admin en el F5).
    if (loading) return;

    if (!user?.id) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);
    const fetchProfile = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('role, company, full_name, status')
        .eq('id', user.id)
        .single();

      if (data) setProfile(data);
      setProfileLoading(false);
    };

    fetchProfile();
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

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, profileLoading, login, logout }}>
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
