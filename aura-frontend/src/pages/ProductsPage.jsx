import { useState, useEffect, useCallback } from 'react';
import Sidebar from '../components/Sidebar';
import GlassCard from '../components/GlassCard';
import GradientButton from '../components/GradientButton';
import MaterialIcon from '../components/MaterialIcon';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { normalizeProductData, pickProductFields, filterProducts } from '../lib/productCatalog';
import Avatar from '../components/Avatar';

const PAGE_SIZE = 8;

// user-panel-features, Grupo 5 (design.md D6/D5). `products` es una fila por
// usuario con el catálogo entero en product_data jsonb: no hay CRUD
// relacional acá. Alta, baja y edición van SIEMPRE por las RPC security
// definer (product_catalog_add/remove/update), nunca por un update directo
// del campo — eso es justo lo que este change vino a corregir (D6: elimina
// la ventana de lost-update frente al bot, que escribe con service role en
// paralelo).

const emptyEditForm = { producto: '', precio: '', detalle: '' };

export default function ProductsPage() {
  const { user, profile } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);
  const [form, setForm] = useState({ producto: '', precio: '', detalle: '' });
  const [confirmDelete, setConfirmDelete] = useState(null); // id del item a borrar
  const [deletingId, setDeletingId] = useState(null);
  const [editing, setEditing] = useState(null); // { id, nameKey, priceKey, descKey } del item en edición
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editError, setEditError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const filteredItems = filterProducts(items, search);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const pageItems = filteredItems.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [search]);

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
      setShowAddModal(false);
    } catch (err) {
      console.error('Error al agregar producto:', err.message);
      setAddError('No se pudo agregar el producto. Intentá de nuevo.');
    } finally {
      setAdding(false);
    }
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setForm({ producto: '', precio: '', detalle: '' });
    setAddError(null);
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

  const openEdit = (rawItem) => {
    const { name, price, description, nameKey, priceKey, descKey } = pickProductFields(rawItem);
    setEditing({ id: rawItem.id, nameKey, priceKey, descKey });
    setEditForm({
      producto: name !== null ? String(name) : '',
      precio: price !== null ? String(price) : '',
      detalle: description !== null ? String(description) : '',
    });
    setEditError(null);
  };

  const closeEdit = () => {
    setEditing(null);
    setEditForm(emptyEditForm);
    setEditError(null);
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setEditError(null);
    if (!editForm.producto.trim()) {
      setEditError('El nombre del producto es obligatorio.');
      return;
    }
    setSaving(true);
    try {
      // Escribe en la MISMA clave que ya tenía el item (p. ej. "nombre del
      // producto" en items extraídos de un PDF) en vez de siempre
      // "producto" -- si no, quedaría una clave vieja duplicada y stale.
      // Un campo opcional vaciado manda null explícito: la RPC lo interpreta
      // como "borrar esa clave" (jsonb_strip_nulls), no como texto vacío.
      const updates = { [editing.nameKey || 'producto']: editForm.producto.trim() };
      updates[editing.priceKey || 'precio'] = editForm.precio.trim() || null;
      updates[editing.descKey || 'detalle'] = editForm.detalle.trim() || null;

      const { data, error: rpcError } = await supabase.rpc('product_catalog_update', {
        product_id: editing.id,
        updates,
      });
      if (rpcError) throw rpcError;
      setItems(normalizeProductData(data));
      closeEdit();
    } catch (err) {
      console.error('Error al editar producto:', err.message);
      setEditError('No se pudo guardar el cambio. Intentá de nuevo.');
    } finally {
      setSaving(false);
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
              <Avatar avatarKey={profile?.avatar_key} size="text-[22px]" />
            </div>
          </div>
        </header>

        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12 relative z-10">
          <section className="mb-6 flex flex-col md:flex-row md:items-center gap-6">
            <div className="flex-1">
              <h2 className="font-display-lg text-display-lg text-on-surface mb-4">Tu catálogo</h2>
              <p className="font-body-md text-on-surface-variant max-w-2xl">
                Estos son los productos que Aura conoce — los que cargaste vos y los que el bot extrajo de tus PDFs e imágenes.
                Podés agregar uno nuevo, editar los datos o eliminar los que ya no correspondan.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="glass-card rounded-2xl p-5 w-full md:w-auto md:min-w-[260px] shrink-0 flex items-center gap-3 text-left hover:border-primary/30 hover:-translate-y-0.5 transition-all duration-300"
            >
              <div className="w-11 h-11 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <MaterialIcon icon="add_circle" size="text-[22px]" />
              </div>
              <div>
                <p className="font-bold text-on-surface">Agregar producto</p>
                <p className="font-label-sm text-on-surface-variant">Cargá un producto nuevo a mano</p>
              </div>
            </button>
          </section>

          <div className="relative mb-4 max-w-md">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-outline text-[20px] pointer-events-none">search</span>
            <input
              type="text"
              placeholder="Buscar por nombre, precio o detalle..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-surface-container-low border-none rounded-full pl-10 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/40 w-full transition-all outline-none text-on-surface placeholder:text-outline/40"
            />
          </div>

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
                <div key={i} className="h-14 glass-card rounded-xl animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <GlassCard className="p-12 flex flex-col items-center text-center" hover={false}>
              <MaterialIcon icon="inventory_2" className="text-on-surface-variant text-4xl mb-4" />
              <p className="font-body-md text-on-surface-variant">
                Todavía no tenés productos. Agregá tu primer producto arriba, o subile un PDF, una imagen o una descripción a tu bot de Telegram.
              </p>
            </GlassCard>
          ) : filteredItems.length === 0 ? (
            <GlassCard className="p-12 flex flex-col items-center text-center" hover={false}>
              <MaterialIcon icon="search_off" className="text-on-surface-variant text-4xl mb-4" />
              <p className="font-body-md text-on-surface-variant">
                Ningún producto coincide con "{search}".
              </p>
            </GlassCard>
          ) : (
            <GlassCard hover={false} className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      <th className="px-6 py-4 font-bold text-sm text-outline uppercase tracking-wider">Producto</th>
                      <th className="px-6 py-4 font-bold text-sm text-outline uppercase tracking-wider">Precio</th>
                      <th className="px-6 py-4 font-bold text-sm text-outline uppercase tracking-wider">Detalle</th>
                      <th className="px-6 py-4 font-bold text-sm text-outline uppercase tracking-wider">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {pageItems.map((rawItem) => {
                      const id = rawItem.id;
                      const { name, price, description, extra } = pickProductFields(rawItem);
                      const isDeleting = deletingId === id;
                      return (
                        <tr
                          key={id || JSON.stringify(rawItem)}
                          className={`hover:bg-white/[0.03] transition-colors group ${isDeleting ? 'opacity-50 pointer-events-none' : ''}`}
                        >
                          <td className="px-6 py-4 max-w-xs">
                            <span className="font-medium text-on-surface truncate block">{name || 'Producto sin nombre'}</span>
                            {!id && (
                              <span className="text-[10px] text-amber-400 mt-1 flex items-center gap-1">
                                <MaterialIcon icon="warning" size="text-xs" />
                                Sin id — se asignará al tocarlo
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-primary font-bold whitespace-nowrap">
                            {price !== null ? String(price) : <span className="text-on-surface-variant/60 font-normal italic">—</span>}
                          </td>
                          <td className="px-6 py-4 text-on-surface-variant max-w-sm">
                            <span className="line-clamp-2">
                              {description !== null ? String(description) : <span className="text-on-surface-variant/60 italic">—</span>}
                            </span>
                            {extra.length > 0 && (
                              <span
                                className="block text-[11px] text-on-surface-variant/70 mt-0.5"
                                title={extra.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n')}
                              >
                                +{extra.length} campo{extra.length > 1 ? 's' : ''} más
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openEdit(rawItem)}
                                disabled={!id}
                                title={!id ? 'Este item todavía no tiene id asignado' : 'Editar'}
                                className="w-9 h-9 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-all disabled:opacity-30"
                              >
                                <MaterialIcon icon="edit" size="text-sm" />
                              </button>
                              <button
                                onClick={() => id && setConfirmDelete(id)}
                                disabled={!id || isDeleting}
                                title={!id ? 'Este item todavía no tiene id asignado' : 'Eliminar'}
                                className="w-9 h-9 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-error/10 hover:text-error transition-all disabled:opacity-30"
                              >
                                {isDeleting ? (
                                  <MaterialIcon icon="autorenew" className="animate-spin" size="text-sm" />
                                ) : (
                                  <MaterialIcon icon="delete" size="text-sm" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
                  <p className="text-sm text-on-surface-variant">
                    Mostrando {page * PAGE_SIZE + 1}–{Math.min(filteredItems.length, page * PAGE_SIZE + PAGE_SIZE)} de {filteredItems.length}
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="px-3 py-1.5 rounded-lg text-sm text-on-surface-variant hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Anterior
                    </button>
                    <span className="text-sm text-outline">
                      Página {page + 1} de {totalPages}
                    </span>
                    <button
                      onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
                      disabled={page + 1 >= totalPages}
                      className="px-3 py-1.5 rounded-lg text-sm text-on-surface-variant hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </GlassCard>
          )}
        </div>

        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="glass-card rounded-2xl p-8 max-w-md w-full">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-headline-lg text-xl text-on-surface flex items-center gap-2">
                  <MaterialIcon icon="add_circle" className="text-primary" />
                  Agregar producto
                </h3>
                <button onClick={closeAddModal} className="text-on-surface-variant hover:text-on-surface transition-colors" aria-label="Cerrar">
                  <MaterialIcon icon="close" />
                </button>
              </div>
              <form onSubmit={handleAdd} className="space-y-3">
                <input
                  type="text"
                  placeholder="Nombre del producto *"
                  value={form.producto}
                  onChange={(e) => setForm({ ...form, producto: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-surface-container-highest border border-white/10 outline-none focus:border-primary transition-all"
                  maxLength={200}
                  autoFocus
                />
                <input
                  type="text"
                  placeholder="Precio (opcional)"
                  value={form.precio}
                  onChange={(e) => setForm({ ...form, precio: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-surface-container-highest border border-white/10 outline-none focus:border-primary transition-all"
                  maxLength={50}
                />
                <textarea
                  placeholder="Detalle (opcional)"
                  value={form.detalle}
                  onChange={(e) => setForm({ ...form, detalle: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-surface-container-highest border border-white/10 outline-none focus:border-primary transition-all resize-none"
                  rows={3}
                  maxLength={500}
                />
                {addError && <p className="font-label-sm text-error">{addError}</p>}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeAddModal}
                    className="flex-1 py-3 rounded-xl bg-surface-container-highest border border-white/10 text-on-surface font-bold font-label-sm hover:brightness-110 active:scale-95 transition-all"
                  >
                    Cancelar
                  </button>
                  <GradientButton type="submit" loading={adding} className="flex-1 py-3">
                    <MaterialIcon icon="add" size="text-sm" />
                    Agregar
                  </GradientButton>
                </div>
              </form>
            </div>
          </div>
        )}

        {editing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="glass-card rounded-2xl p-8 max-w-md w-full">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-headline-lg text-xl text-on-surface flex items-center gap-2">
                  <MaterialIcon icon="edit" className="text-primary" />
                  Editar producto
                </h3>
                <button onClick={closeEdit} className="text-on-surface-variant hover:text-on-surface transition-colors" aria-label="Cerrar">
                  <MaterialIcon icon="close" />
                </button>
              </div>
              <form onSubmit={handleSaveEdit} className="space-y-3">
                <input
                  type="text"
                  placeholder="Nombre del producto *"
                  value={editForm.producto}
                  onChange={(e) => setEditForm({ ...editForm, producto: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-surface-container-highest border border-white/10 outline-none focus:border-primary transition-all"
                  maxLength={200}
                  autoFocus
                />
                <input
                  type="text"
                  placeholder="Precio (opcional)"
                  value={editForm.precio}
                  onChange={(e) => setEditForm({ ...editForm, precio: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-surface-container-highest border border-white/10 outline-none focus:border-primary transition-all"
                  maxLength={50}
                />
                <textarea
                  placeholder="Detalle (opcional)"
                  value={editForm.detalle}
                  onChange={(e) => setEditForm({ ...editForm, detalle: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-surface-container-highest border border-white/10 outline-none focus:border-primary transition-all resize-none"
                  rows={3}
                  maxLength={500}
                />
                {editError && <p className="font-label-sm text-error">{editError}</p>}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeEdit}
                    className="flex-1 py-3 rounded-xl bg-surface-container-highest border border-white/10 text-on-surface font-bold font-label-sm hover:brightness-110 active:scale-95 transition-all"
                  >
                    Cancelar
                  </button>
                  <GradientButton type="submit" loading={saving} className="flex-1 py-3">
                    <MaterialIcon icon="check" size="text-sm" />
                    Guardar
                  </GradientButton>
                </div>
              </form>
            </div>
          </div>
        )}

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
