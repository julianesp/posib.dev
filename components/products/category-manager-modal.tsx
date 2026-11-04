'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Plus, Trash2, Pencil, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCategories, createCategory, updateCategory, deleteCategory } from '@/lib/cloudflare-api';
import { Category } from '@/lib/types';
import { toast } from 'sonner';

interface CategoryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: () => void;
}

export function CategoryManagerModal({ isOpen, onClose, onUpdate }: CategoryManagerModalProps) {
  const { getToken } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
  });

  useEffect(() => {
    if (isOpen) {
      fetchCategories();
    }
  }, [isOpen]);

  const fetchCategories = async () => {
    try {
      const data = await getCategories(getToken) as Category[];
      data.sort((a, b) => a.name.localeCompare(b.name));
      setCategories(data);
    } catch (error) {
      console.error('Error fetching categories:', error);
      toast.error('Error al cargar categorías');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('El nombre es requerido');
      return;
    }

    setLoading(true);
    try {
      if (editingCategory) {
        await updateCategory(editingCategory.id, formData, getToken);
        toast.success('Categoría actualizada correctamente');
      } else {
        await createCategory(formData, getToken);
        toast.success('Categoría creada correctamente');
      }

      setFormData({ name: '', description: '' });
      setShowForm(false);
      setEditingCategory(null);
      fetchCategories();
      onUpdate?.();
    } catch (error) {
      console.error('Error saving category:', error);
      toast.error(error instanceof Error ? error.message : 'Error al guardar categoría');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (category: Category) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      description: category.description || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Estás seguro de eliminar la categoría "${name}"?`)) {
      return;
    }

    try {
      await deleteCategory(id, getToken);
      toast.success('Categoría eliminada correctamente');
      fetchCategories();
      onUpdate?.();
    } catch (error) {
      console.error('Error deleting category:', error);
      toast.error(error instanceof Error ? error.message : 'Error al eliminar categoría');
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingCategory(null);
    setFormData({ name: '', description: '' });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold">Gestionar Categorías</h2>
            <p className="text-gray-500 text-sm">Administra las categorías de productos</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-black hover:text-white hover:scale-90 scale-100 transition-all border cursor-pointer rounded-full  "
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Botón para mostrar formulario */}
          {!showForm && (
            <div className="flex justify-end">
              <Button onClick={() => setShowForm(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Nueva Categoría
              </Button>
            </div>
          )}

          {/* Formulario */}
          {showForm && (
            <Card>
              <CardHeader>
                <CardTitle>{editingCategory ? 'Editar' : 'Nueva'} Categoría</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Nombre *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Nombre de la categoría"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Descripción</Label>
                      <Input
                        id="description"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Descripción opcional"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={loading}>
                      {loading ? 'Guardando...' : editingCategory ? 'Actualizar' : 'Crear'}
                    </Button>
                    <Button type="button" variant="outline" onClick={handleCancel}>
                      Cancelar
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Lista de categorías */}
          <Card>
            <CardHeader>
              <CardTitle>Categorías ({categories.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {categories.length === 0 ? (
                <div className="text-center py-12">
                  <Tag className="mx-auto h-12 w-12 text-gray-400" />
                  <p className="mt-4 text-gray-500">No hay categorías registradas</p>
                  <Button className="mt-4" onClick={() => setShowForm(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Crear Primera Categoría
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {categories.map((category) => (
                    <div
                      key={category.id}
                      className="border rounded-lg p-4 hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2 flex-1">
                          <Tag className="h-5 w-5 text-brand flex-shrink-0" />
                          <h3 className="font-semibold">{category.name}</h3>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleEdit(category)}
                            className="p-1 hover:bg-gray-100 rounded"
                            title="Editar"
                          >
                            <Pencil className="h-4 w-4 text-brand" />
                          </button>
                          <button
                            onClick={() => handleDelete(category.id, category.name)}
                            className="p-1 hover:bg-gray-100 rounded"
                            title="Eliminar"
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </button>
                        </div>
                      </div>
                      {category.description && (
                        <p className="text-sm text-gray-500">{category.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Footer */}
        <div className="flex justify-end p-6 border-t bg-gray-50 ">
          <Button onClick={onClose} variant="outline" className='hover:bg-black hover:text-white  transition-all border cursor-pointer'>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
