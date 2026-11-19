'use client';

import { useState, useEffect } from 'react';
import { useUser, useAuth } from '@clerk/nextjs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getAllUserProfiles, updateUserProfile } from '@/lib/cloudflare-api';
import { UserProfile } from '@/lib/types';
import {
  Users,
  Search,
  Shield,
  Mail,
  Calendar,
  UserCog,
  Ban,
  CheckCircle,
  Crown,
  Trash2,
  Store,
  Landmark,
} from 'lucide-react';
import { toast } from 'sonner';
import { getUserProfileByClerkId } from '@/lib/subscription-helpers';

export default function UsersManagementPage() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    fetchData();
  }, [user]);

  const fetchData = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const allProfiles = await getAllUserProfiles(getToken);

      // Obtener perfil del usuario actual
      const myProfile = allProfiles.find(p => p.clerk_user_id === user.id);
      setCurrentUserProfile(myProfile || null);

      // Verificar si es super admin
      if (!myProfile?.is_superadmin) {
        toast.error('No tienes permisos para acceder a esta página');
        return;
      }

      // Ordenar por fecha de creación
      allProfiles.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setUsers(allProfiles);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Error al cargar usuarios');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRole = async (userId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'cajero' : 'admin';

    try {
      await updateUserProfile(userId, {
        role: newRole,
      }, getToken);
      toast.success(`Rol actualizado a ${newRole === 'admin' ? 'Administrador' : 'Cajero'}`);
      fetchData();
    } catch (error) {
      console.error('Error updating role:', error);
      toast.error('Error al actualizar el rol');
    }
  };

  const handleToggleStore = async (userId: string, currentEnabled: boolean) => {
    try {
      await updateUserProfile(userId, {
        store_enabled: !currentEnabled,
      }, getToken);
      toast.success(
        !currentEnabled ? 'Tienda online habilitada' : 'Tienda online deshabilitada',
      );
      fetchData();
    } catch (error) {
      console.error('Error updating store status:', error);
      toast.error('Error al actualizar la tienda online');
    }
  };

  /** Facturación electrónica DIAN: solo se activa a mano, tienda por tienda. */
  const handleToggleFe = async (usr: UserProfile) => {
    const activar = !usr.has_fe_addon;
    if (activar) {
      const Swal = (await import('sweetalert2')).default;
      const r = await Swal.fire({
        title: '¿Activar facturación electrónica?',
        html: `<b>${usr.email}</b> podrá configurar su firma digital y facturar electrónicamente ante la DIAN desde posib.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, activar',
        cancelButtonText: 'Cancelar',
      });
      if (!r.isConfirmed) return;
    }
    try {
      await updateUserProfile(usr.id, { has_fe_addon: activar }, getToken);
      toast.success(activar ? 'Facturación electrónica activada' : 'Facturación electrónica desactivada');
      fetchData();
    } catch (error) {
      console.error('Error updating FE:', error);
      toast.error('Error al cambiar la facturación electrónica');
    }
  };

  const handleDeleteUser = async (userId: string, userEmail: string) => {
    const Swal = (await import('sweetalert2')).default;
    const result = await Swal.fire({
      title: '¿Eliminar usuario?',
      html: `Esta acción eliminará permanentemente a <b>${userEmail}</b> y todos sus datos.<br><br>Esta acción <b>no se puede deshacer</b>.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
    });

    if (!result.isConfirmed) return;

    try {
      const response = await fetch('/api/admin/delete-user', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIdToDelete: userId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Error al eliminar usuario');
      }

      toast.success('Usuario eliminado correctamente');
      fetchData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar usuario');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Cargando usuarios...</p>
      </div>
    );
  }

  if (!currentUserProfile?.is_superadmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <Shield className="h-12 w-12 mx-auto text-red-500 mb-4" />
            <h2 className="text-xl font-bold mb-2">Acceso Denegado</h2>
            <p className="text-gray-500">No tienes permisos para acceder a esta página.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filteredUsers = users.filter((u) =>
    u.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Estadísticas
  const totalUsers = users.length;
  const superAdmins = users.filter(u => u.is_superadmin).length;
  const admins = users.filter(u => !u.is_superadmin && u.role === 'admin').length;
  const cajeros = users.filter(u => u.role === 'cajero').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Users className="h-8 w-8 text-brand" />
        <div>
          <h1 className="text-3xl font-bold">Gestión de Usuarios</h1>
          <p className="text-gray-500">Administra todos los usuarios del sistema</p>
        </div>
      </div>

      {/* Estadísticas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Usuarios</CardTitle>
            <Users className="h-4 w-4 text-gray-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalUsers}</div>
            <p className="text-xs text-gray-500">Usuarios registrados</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Super Admins</CardTitle>
            <Crown className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{superAdmins}</div>
            <p className="text-xs text-gray-500">Administradores totales</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Admins de Tienda</CardTitle>
            <Shield className="h-4 w-4 text-brand" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-brand">{admins}</div>
            <p className="text-xs text-gray-500">Propietarios de tienda</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cajeros</CardTitle>
            <UserCog className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{cajeros}</div>
            <p className="text-xs text-gray-500">Empleados</p>
          </CardContent>
        </Card>
      </div>

      {/* Buscador */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Buscar por nombre o email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Lista de usuarios */}
      <Card>
        <CardHeader>
          <CardTitle>Usuarios del Sistema ({filteredUsers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredUsers.length === 0 ? (
            <div className="text-center py-12">
              <Users className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-4 text-gray-500">No hay usuarios registrados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-4 font-medium">Usuario</th>
                    <th className="text-left p-4 font-medium">Email</th>
                    <th className="text-left p-4 font-medium">Rol</th>
                    <th className="text-left p-4 font-medium">Estado</th>
                    <th className="text-left p-4 font-medium">Registro</th>
                    <th className="text-right p-4 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((usr) => {
                    const createdDate = new Date(usr.created_at).toLocaleDateString('es-CO');
                    const roleConfig = {
                      admin: { label: 'Admin Tienda', color: 'bg-brand-light text-brand' },
                      cajero: { label: 'Cajero', color: 'bg-green-100 text-green-800' },
                    };

                    const statusConfig = {
                      active: { label: 'Activo', color: 'bg-green-100 text-green-800' },
                      trial: { label: 'Prueba', color: 'bg-yellow-100 text-yellow-800' },
                      expired: { label: 'Expirado', color: 'bg-red-100 text-red-800' },
                      canceled: { label: 'Cancelado', color: 'bg-gray-100 text-gray-800' },
                    };

                    const role = roleConfig[usr.role];
                    const status = statusConfig[usr.subscription_status];

                    return (
                      <tr key={usr.id} className="border-b hover:bg-gray-50">
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            {usr.is_superadmin && (
                              <span title="Super Admin">
                                <Crown className="h-4 w-4 text-purple-600" />
                              </span>
                            )}
                            <div>
                              <div className="font-medium">{usr.full_name || 'Sin nombre'}</div>
                              <div className="text-sm text-gray-500">
                                {usr.is_superadmin ? 'Super Administrador' : role.label}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2 text-sm">
                            <Mail className="h-4 w-4 text-gray-400" />
                            {usr.email}
                          </div>
                        </td>
                        <td className="p-4">
                          {usr.is_superadmin ? (
                            <span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                              Super Admin
                            </span>
                          ) : (
                            <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${role.color}`}>
                              {role.label}
                            </span>
                          )}
                        </td>
                        <td className="p-4">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${status.color}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <Calendar className="h-4 w-4 text-gray-400" />
                            {createdDate}
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex gap-2 justify-end">
                            {!usr.is_superadmin && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleToggleRole(usr.id, usr.role)}
                                title="Cambiar rol"
                              >
                                <UserCog className="h-4 w-4 mr-1" />
                                {usr.role === 'admin' ? 'A Cajero' : 'A Admin'}
                              </Button>
                            )}
                            {!usr.is_superadmin && (
                              <Button
                                size="sm"
                                variant={usr.store_enabled ? 'default' : 'outline'}
                                onClick={() => handleToggleStore(usr.id, !!usr.store_enabled)}
                                title={usr.store_enabled ? 'Deshabilitar tienda online' : 'Habilitar tienda online'}
                              >
                                <Store className="h-4 w-4 mr-1" />
                                {usr.store_enabled ? 'Tienda ON' : 'Tienda OFF'}
                              </Button>
                            )}
                            {!usr.is_superadmin && (
                              <Button
                                size="sm"
                                variant={usr.has_fe_addon ? 'default' : 'outline'}
                                onClick={() => handleToggleFe(usr)}
                                title={usr.has_fe_addon ? 'Desactivar facturación electrónica' : 'Activar facturación electrónica DIAN'}
                              >
                                <Landmark className="h-4 w-4 mr-1" />
                                {usr.has_fe_addon ? 'Facturación ON' : 'Facturación OFF'}
                              </Button>
                            )}
                            {!usr.is_superadmin && usr.id !== currentUserProfile?.id && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleDeleteUser(usr.id, usr.email)}
                                title="Eliminar usuario"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
