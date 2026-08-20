import { useState, useEffect, useCallback } from 'react';
import Sidebar from '../components/Sidebar';
import GlassCard from '../components/GlassCard';
import GradientButton from '../components/GradientButton';
import MaterialIcon from '../components/MaterialIcon';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { normalizeProductData, pickProductFields } from '../lib/productCatalog';

// user-panel-features, Grupo 5 (design.md D6/D5). `products` es una fila por
// usuario con el catálogo entero en product_data jsonb: no hay CRUD
// relacional acá. Alta y baja van SIEMPRE por las RPC security definer
// (product_catalog_add/remove), nunca por un update directo del campo — eso
// es justo lo que este change vino a corregir (D6: elimina la ventana de
// lost-update frente al bot, que escribe con service role en paralelo).

export default function ProductsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);
  const [form, setForm] = useState({ producto: '', precio: '', detalle: '' });
  const [confirmDelete, setConfirmDelete] = useState(null); // id del item a borrar
  const [deletingId, setDeletingId] = useState(null);

  const loadCatalog = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('products')
        .select('product_data')
        .eq('user_id', user.id)
        .maybeSingle();
      if (fetchError) throw fetchError;
      setItems(normalizeProductData(data?.product_data));
    } catch (err) {
      console.error('Error al cargar el catálogo:', err.message);
      setError('No se pudo cargar tu catálogo. Intentá de nuevo más tarde.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const handleAdd = async (e) => {
    e.preventDefault();
    setAddError(null);
    if (!form.producto.trim()) {
      setAddError('El nombre del producto es obligatorio.');
      return;
    }
    setAdding(true);
    try {
      const item = { producto: form.producto.trim() };
      if (form.precio.trim()) item.precio = form.precio.trim();
      if (form.detalle.trim()) item.detalle = form.detalle.trim();

      const { data, error: rpcError } = await supabase.rpc('product_catalog_add', { item });
      if (rpcError) throw rpcError;
      // Refresco con lo que devuelve el servidor, no con estado optimista
      // local (tasks.md 5.6): el bot puede escribir en paralelo.
      setItems(normalizeProductData(data));
      setForm({ producto: '', precio: '', detalle: '' });
    } catch (err) {
      console.error('Error al agregar producto:', err.message);
      setAddError('No se pudo agregar el producto. Intentá de nuevo.');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id) => {
    setDeletingId(id);
    try {
      const { data, error: rpcError } = await supabase.rpc('product_catalog_remove', { product_id: id });
      if (rpcError) throw rpcError;
      setItems(normalizeProductData(data));
    } catch (err) {
      console.error('Error al eliminar producto:', err.message);
      setError('No se pudo eliminar el producto. Intentá de nuevo.');
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  };

  return (
    <div className="min-h-screen bg-surface-dim text-on-surface">
      <Sidebar />
      <main className="md:ml-64 min-h-screen overflow-y-auto relative">
        <header className="sticky top-0 z-40 bg-surface-container-lowest/80 backdrop-blur-xl border-b border-white/10 px-margin-mobile md:px-margin-desktop h-16 flex justify-between items-center">
          <div className="md:hidden flex items-center gap-2">
            <button
              onClick={() => document.dispatchEvent(new CustomEvent('open-sidebar'))}
              className="p-1 -ml-1 rounded-lg text-primary hover:bg-white/5 active:scale-95 transition-all"
              aria-label="Abrir menú"
            >
              <MaterialIcon icon="menu" />
            </button>
            <span className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-primary">Aura</span>
          </div>
          <div className="hidden md:block">
            <span className="text-on-surface-variant font-label-sm">
              <span className="text-primary">Productos</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full overflow-hidden border border-white/10 cursor-pointer active:scale-95 transition-all">
              <MaterialIcon icon="account_circle" size="text-[32px]" />
            </div>
          </div>
        </header>

        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12 relative z-10">
          <section className="mb-8">
            <h2 className="font-display-lg text-display-lg text-on-surface mb-4">Tu catálogo</h2>
            <p className="font-body-md text-on-surface-variant max-w-2xl">
              Estos son los productos que Aura conoce — los que cargaste vos y los que el bot extrajo de tus PDFs e imágenes.
              Podés agregar uno nuevo o eliminar los que ya no correspondan.
            </p>
          </section>

          <GlassCard className="p-6 mb-8" hover={false}>
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
              <MaterialIcon icon="add_circle" className="text-primary" />
              Agregar producto
            </h3>
            <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="text"
                placeholder="Nombre del producto *"
                value={form.producto}
                onChange={(e) => setForm({ ...form, producto: e.target.value })}
                className="px-4 py-3 rounded-xl bg-surface-container-highest border border-white/10 outline-none focus:border-primary transition-all"
                maxLength={200}
              />
              <input
                type="text"
                placeholder="Precio (opcional)"
                value={form.precio}
                onChange={(e) => setForm({ ...form, precio: e.target.value })}
                className="px-4 py-3 rounded-xl bg-surface-container-highest border border-white/10 outline-none focus:border-primary transition-all"
                maxLength={50}
              />
              <input
                type="text"
                placeholder="Detalle (opcional)"
                value={form.detalle}
                onChange={(e) => setForm({ ...form, detalle: e.target.value })}
                className="px-4 py-3 rounded-xl bg-surface-container-highest border border-white/10 outline-none focus:border-primary transition-all"
                maxLength={500}
              />
              <div className="md:col-span-3 flex items-center gap-3">
                <GradientButton type="submit" loading={adding} className="py-3 px-6">
                  <MaterialIcon icon="add" size="text-sm" />
                  Agregar
                </GradientButton>
                {addError && <p className="font-label-sm text-error">{addError}</p>}
              </div>
            </form>
          </GlassCard>

          {error && (
            <section className="p-6 glass-card rounded-xl border-l-4 border-l-error mb-8">
              <div className="flex items-start gap-3">
                <MaterialIcon icon="error" className="text-error mt-1" />
                <div>
                  <p className="font-body-md text-error font-bold mb-1">Error</p>
                  <p className="font-body-md text-on-surface-variant">{error}</p>
                  <button onClick={loadCatalog} className="mt-3 text-primary font-bold font-label-sm hover:underline">
                    Intentar de nuevo
                  </button>
                </div>
              </div>
            </section>
          )}

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 glass-card rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <GlassCard className="p-12 flex flex-col items-center text-center" hover={false}>
              <MaterialIcon icon="inventory_2" className="text-on-surface-variant text-4xl mb-4" />
              <p className="font-body-md text-on-surface-variant">
                Todavía no tenés productos. Agregá tu primer producto arriba, o subile un PDF, una imagen o una descripción a tu bot de Telegram.
              </p>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {items.map((rawItem) => {
                const id = rawItem.id;
                const { name, price, description, extra } = pickProductFields(rawItem);
                return (
                  <GlassCard key={id || JSON.stringify(rawItem)} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="font-bold text-base truncate">{name || 'Producto sin nombre'}</h4>
                        {price !== null && (
                          <p className="text-primary font-bold font-label-sm mt-0.5">{String(price)}</p>
                        )}
                        {description !== null && (
                          <p className="font-body-sm text-on-surface-variant mt-1">{String(description)}</p>
                        )}
                        {extra.length > 0 && (
                          <dl className="mt-2 space-y-0.5">
                            {extra.map(([key, value]) => (
                              <div key={key} className="flex gap-1 text-[11px] text-on-surface-variant">
                                <dt className="font-bold capitalize">{key.replace(/_/g, ' ')}:</dt>
                                <dd className="truncate">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        {!id && (
                          <p className="text-[10px] text-amber-400 mt-2 flex items-center gap-1">
                            <MaterialIcon icon="warning" size="text-xs" />
                            Item heredado sin id — se le asignará uno la próxima vez que se toque el catálogo.
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => id && setConfirmDelete(id)}
                        disabled={!id || deletingId === id}
                        title={!id ? 'Este item todavía no tiene id asignado' : 'Eliminar'}
                        className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-error/10 hover:text-error transition-all disabled:opacity-30"
                      >
                        {deletingId === id ? (
                          <MaterialIcon icon="autorenew" className="animate-spin" size="text-sm" />
                        ) : (
                          <MaterialIcon icon="delete" size="text-sm" />
                        )}
                      </button>
                    </div>
                  </GlassCard>
                );
              })}
            </div>
          )}
        </div>

        {confirmDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="glass-card rounded-2xl p-8 max-w-sm w-full mx-4">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-full bg-error/20 flex items-center justify-center">
                  <MaterialIcon icon="warning" className="text-error" fill />
                </div>
                <h3 className="font-headline-lg text-xl text-on-surface">Eliminar producto</h3>
              </div>
              <p className="font-body-md text-on-surface-variant mb-8">
                Esta acción no se puede deshacer. ¿Confirmás que querés eliminar este producto de tu catálogo?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="flex-1 py-3 rounded-xl bg-surface-container-highest border border-white/10 text-on-surface font-bold font-label-sm hover:brightness-110 active:scale-95 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleRemove(confirmDelete)}
                  disabled={deletingId === confirmDelete}
                  className="flex-1 py-3 rounded-xl bg-error text-on-error font-bold font-label-sm hover:brightness-110 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {deletingId === confirmDelete ? (
                    <MaterialIcon icon="autorenew" className="animate-spin" />
                  ) : (
                    <MaterialIcon icon="delete" />
                  )}
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
