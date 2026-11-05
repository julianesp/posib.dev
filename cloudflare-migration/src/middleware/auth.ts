/**
 * Authentication Middleware
 * Validates Clerk JWT tokens and attaches tenant context to requests
 */

import { Context, Next } from 'hono';
import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose';
import type { Env, AppEnv, Tenant } from '../types';
import { TenantManager } from '../utils/tenant-manager';

// Cache de JWKS por issuer. createRemoteJWKSet ya cachea las claves en memoria
// y solo vuelve a buscar en la red cuando aparece un `kid` desconocido, así que
// reutilizar la misma instancia entre invocaciones evita refetches innecesarios.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJWKS(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer.replace(/\/$/, '')}/.well-known/jwks.json`));
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

// Rutas que un usuario con suscripción vencida/cancelada DEBE poder usar de
// todos modos: leer/actualizar su propio perfil, resolver sus tiendas, y todo
// el flujo de pago/renovación. Si el 402 bloqueara estas rutas, el front no
// podría siquiera saber que la cuenta está expirada ni ofrecer un enlace para
// pagar: el usuario queda varado sin salida. El gate 402 solo debe proteger los
// datos del negocio (ventas, productos, clientes, etc.), nunca la identidad ni
// el pago. Se compara por prefijo contra el pathname de la petición.
const SUBSCRIPTION_EXEMPT_PREFIXES = [
  '/api/user-profiles',
  '/api/user-stores',
  '/api/subscriptions',
  '/api/payment-transactions',
  // Precios de planes por tipo de negocio: el flujo de pago los consulta para
  // armar el enlace de renovación, así que deben leerse aun estando vencido.
  '/api/business-type-prices',
];

function isSubscriptionExemptPath(pathname: string): boolean {
  return SUBSCRIPTION_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/')
  );
}

// Solo se aceptan los issuers de NUESTRAS instancias de Clerk, comparados de
// forma exacta. Antes se aceptaba cualquier host "clerk.*" o "*.clerk.accounts.dev":
// un atacante podía publicar su propio JWKS en clerk.<su-dominio>, firmar un
// token con el `sub` de otro usuario (incluido el superadmin) y el Worker lo
// daba por válido. La lista viene de CLERK_JWT_ISSUERS (separada por comas, en
// wrangler.toml) y de CLERK_JWT_ISSUER.
export function isAllowedClerkIssuer(issuer: string, env: Env): boolean {
  const allowed = [env.CLERK_JWT_ISSUER, ...(env.CLERK_JWT_ISSUERS ?? '').split(',')]
    .map((i) => (i ?? '').trim().replace(/\/$/, ''))
    .filter(Boolean);
  return allowed.includes(issuer.replace(/\/$/, ''));
}

// Margen tras la fecha de vencimiento antes de bloquear en el Worker. El front
// marca "expired" desde la medianoche (hora local) del día siguiente; con 24 h
// el Worker nunca bloquea antes que la UI.
const EXPIRY_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Estado real de la suscripción según las FECHAS, no solo el texto guardado.
 * Antes solo el front (al abrir el dashboard) pasaba trial/active → expired;
 * si el dueño no volvía a entrar, el estado quedaba en "trial" para siempre y
 * sus empleados o una llamada directa a la API seguían con acceso gratis.
 */
function effectiveSubscriptionStatus(p: {
  subscription_status: string;
  trial_end_date?: string | null;
  next_billing_date?: string | null;
}): string {
  const limit =
    p.subscription_status === 'trial' ? p.trial_end_date :
    p.subscription_status === 'active' ? p.next_billing_date :
    null;
  if (!limit) return p.subscription_status;
  const end = new Date(limit).getTime();
  if (Number.isNaN(end)) return p.subscription_status;
  return Date.now() > end + EXPIRY_GRACE_MS ? 'expired' : p.subscription_status;
}

async function markExpired(env: Env, profileId: string): Promise<void> {
  try {
    await env.DB
      .prepare(
        `UPDATE user_profiles SET subscription_status = 'expired', updated_at = ?
         WHERE id = ? AND subscription_status IN ('trial', 'active')`
      )
      .bind(new Date().toISOString(), profileId)
      .run();
  } catch (error) {
    console.error('[auth] No se pudo marcar la suscripción como expirada:', error);
  }
}

export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  // Peticiones internas del servidor (webhooks de ePayco, crons) autenticadas
  // con X-Webhook-Secret en lugar de un token de Clerk. Solo se acepta si
  // CRON_SECRET está configurado y coincide exactamente.
  const webhookSecret = c.req.header('X-Webhook-Secret');
  if (webhookSecret) {
    const expectedSecret = c.env.CRON_SECRET;
    if (expectedSecret && webhookSecret === expectedSecret) {
      // Petición interna válida: poner contexto mínimo y continuar.
      c.set('clerkUserId', 'internal-webhook');
      c.set('userProfileId', undefined as any);
      // Tenant mínimo para que las rutas no exploten al leerlo.
      c.set('tenant', {
        id: '',
        clerkUserId: 'internal-webhook',
        email: '',
        databaseName: 'shared',
        databaseId: 'shared',
        subscriptionStatus: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        is_superadmin: true,
      } as any);
      await next();
      return;
    }
    // X-Webhook-Secret presente pero incorrecto → rechazar de inmediato.
    return c.json({
      success: false,
      error: 'Unauthorized',
      message: 'Invalid webhook secret'
    }, 401);
  }

  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({
      success: false,
      error: 'Unauthorized',
      message: 'Missing or invalid authorization header'
    }, 401);
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  try {
    // Verify Clerk JWT
    // Note: In production, you should verify against Clerk's JWKS
    // For now, we'll do basic JWT verification
    const clerkUserId = await verifyClerkToken(token, c.env);

    if (!clerkUserId) {
      return c.json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid token'
      }, 401);
    }

    // Get tenant - either from X-Tenant-ID header or from user's own tenant
    const tenantManager = new TenantManager(c.env);
    const requestedTenantId = c.req.header('X-Tenant-ID');

    let tenant: Tenant | null = null;
    let userProfileId = null;
    let isTeamMember = false; // Flag to track if user is accessing as team member

    // If a specific tenant is requested, validate access
    if (requestedTenantId) {
      // Check if user is a team member of this tenant
      const teamMember = await c.env.DB
        .prepare(`
          SELECT tm.*, up.id as user_profile_id
          FROM team_members tm
          JOIN user_profiles up ON up.id = tm.owner_id
          WHERE (tm.clerk_user_id = ? OR up.clerk_user_id_test = ?)
            AND tm.owner_id = ?
            AND tm.status = 'active'
            AND tm.invitation_status = 'accepted'
        `)
        .bind(clerkUserId, clerkUserId, requestedTenantId)
        .first<any>();

      if (teamMember) {
        // User is a team member - load the owner's tenant
        // The tenant system uses user_profile.id as tenant_id
        isTeamMember = true;
        tenant = await tenantManager.getTenantById(requestedTenantId);
        if (!tenant) {
          // If tenant doesn't exist in TENANTS_DB, create a minimal one
          // This is for compatibility with the user_profiles-based system
          tenant = {
            id: requestedTenantId,
            clerkUserId: '', // Will be filled from user_profile
            email: '',
            databaseName: 'shared',
            databaseId: 'shared',
            subscriptionStatus: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }
        userProfileId = requestedTenantId; // This is the OWNER's profile ID
      } else {
        // Check if user is the owner of this tenant
        const ownerProfile = await c.env.DB
          .prepare('SELECT id FROM user_profiles WHERE (clerk_user_id = ? OR clerk_user_id_test = ?) AND id = ?')
          .bind(clerkUserId, clerkUserId, requestedTenantId)
          .first<{ id: string }>();

        if (ownerProfile) {
          tenant = await tenantManager.getTenantByClerkId(clerkUserId);
          userProfileId = ownerProfile.id;
        } else {
          // Verificar si es superadmin — los superadmins pueden acceder a cualquier tenant
          const superAdminProfile = await c.env.DB
            .prepare('SELECT id FROM user_profiles WHERE (clerk_user_id = ? OR clerk_user_id_test = ?) AND is_superadmin = 1')
            .bind(clerkUserId, clerkUserId)
            .first<{ id: string }>();

          if (superAdminProfile) {
            // Superadmin accede con su propio tenant context
            userProfileId = superAdminProfile.id;
            tenant = await tenantManager.getTenantByClerkId(clerkUserId);
          } else {
            return c.json({
              success: false,
              error: 'Access denied to requested tenant',
              message: 'You do not have access to this store'
            }, 403);
          }
        }
      }
    } else {
      // No specific tenant requested - check if user is a team member first
      console.log('🔍 [authMiddleware] No X-Tenant-ID provided, checking if user is team member...');

      const teamMembership = await c.env.DB
        .prepare(`
          SELECT tm.*, up.id as owner_profile_id, up.store_name
          FROM team_members tm
          JOIN user_profiles up ON up.id = tm.owner_id
          WHERE (tm.clerk_user_id = ? OR up.clerk_user_id_test = ?)
            AND tm.status = 'active'
            AND tm.invitation_status = 'accepted'
          LIMIT 1
        `)
        .bind(clerkUserId, clerkUserId)
        .first<any>();

      if (teamMembership) {
        console.log('👥 [authMiddleware] Usuario es team member de:', teamMembership.store_name);
        // User is a team member - use the owner's tenant
        isTeamMember = true;
        userProfileId = teamMembership.owner_profile_id;
        tenant = await tenantManager.getTenantById(userProfileId);

        if (!tenant) {
          // Create minimal tenant object
          tenant = {
            id: userProfileId,
            clerkUserId: '',
            email: '',
            databaseName: 'shared',
            databaseId: 'shared',
            subscriptionStatus: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }
      } else {
        console.log('👑 [authMiddleware] Usuario no es team member, buscando su propio tenant...');
        // No specific tenant requested - use user's own tenant
        tenant = await tenantManager.getTenantByClerkId(clerkUserId);
      }
    }

    // Fetch Clerk user data once to use for both tenant and user_profile creation
    let clerkUser = null;
    let userEmail = '';
    if (!tenant) {
      const clerkSecretKey = c.env.CLERK_SECRET_KEY;
      if (clerkSecretKey) {
        const { fetchClerkUser, getClerkUserEmail } = await import('../utils/clerk-helpers');
        clerkUser = await fetchClerkUser(clerkUserId, clerkSecretKey);
        userEmail = getClerkUserEmail(clerkUser, clerkUserId);
      } else {
        userEmail = `user_${clerkUserId}@placeholder.com`;
      }
    }

    if (!tenant) {
      // Auto-create tenant on first API call
      try {
        const { generateTenantId } = await import('../utils/tenant-manager');
        console.log('Creating tenant for clerk_user_id:', clerkUserId, 'email:', userEmail);
        tenant = await tenantManager.createTenant(
          generateTenantId(),
          clerkUserId,
          userEmail
        );
      } catch (error) {
        console.error('Error creating tenant:', error);
        return c.json({
          success: false,
          error: 'Failed to create tenant',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
      }
    }

    // Check subscription status (skip for superadmin)
    // Super admins are checked later after getting user_profile
    // if (tenant.subscriptionStatus === 'expired' || tenant.subscriptionStatus === 'canceled') {
    //   return c.json({
    //     success: false,
    //     error: 'Subscription required',
    //     message: 'Your subscription has expired. Please renew to continue.'
    //   }, 402); // Payment Required
    // }

    // IMPORTANT: Get user_profile.id to use as tenant_id for FK constraints
    // The products table has FK to user_profiles, not to tenants table
    let userProfile: { id: string; is_superadmin: number; subscription_status: string; trial_end_date?: string | null; next_billing_date?: string | null } | null = null;

    if (userProfileId) {
      // We already have the userProfileId from tenant selection logic
      userProfile = await c.env.DB
        .prepare('SELECT id, is_superadmin, subscription_status, trial_end_date, next_billing_date FROM user_profiles WHERE id = ?')
        .bind(userProfileId)
        .first<{ id: string; is_superadmin: number; subscription_status: string; trial_end_date?: string | null; next_billing_date?: string | null }>();
    } else {
      // Fallback to clerk_user_id lookup — also check clerk_user_id_test for dev environment
      userProfile = await c.env.DB
        .prepare('SELECT id, is_superadmin, subscription_status, trial_end_date, next_billing_date FROM user_profiles WHERE clerk_user_id = ? OR clerk_user_id_test = ?')
        .bind(clerkUserId, clerkUserId)
        .first<{ id: string; is_superadmin: number; subscription_status: string; trial_end_date?: string | null; next_billing_date?: string | null }>();
    }

    if (!userProfile) {
      // Auto-create user profile on first API call
      try {
        // Fetch real user data from Clerk API if not already fetched
        if (!clerkUser) {
          const clerkSecretKey = c.env.CLERK_SECRET_KEY;
          if (clerkSecretKey) {
            const { fetchClerkUser, getClerkUserEmail } = await import('../utils/clerk-helpers');
            clerkUser = await fetchClerkUser(clerkUserId, clerkSecretKey);
            userEmail = getClerkUserEmail(clerkUser, clerkUserId);

            // Si el email sigue siendo placeholder, el usuario no existe en Clerk — rechazar
            if (userEmail.includes('@placeholder.com')) {
              console.error(`[auth] fetchClerkUser returned null for clerkUserId=${clerkUserId}. CLERK_SECRET_KEY prefix=${c.env.CLERK_SECRET_KEY?.substring(0, 12)}...`);
              return c.json({
                success: false,
                error: 'Unauthorized',
                message: 'User not found in authentication provider',
                debug_clerk_user_id: clerkUserId,
              }, 401);
            }
          } else {
            console.warn('CLERK_SECRET_KEY not configured, using placeholder email');
            userEmail = `user_${clerkUserId}@placeholder.com`;
          }
        }

        // ⚠️ VALIDACIÓN: Verificar si ya existe un perfil con este email
        const existingProfileByEmail = await c.env.DB
          .prepare('SELECT id, clerk_user_id, email, is_superadmin, subscription_status FROM user_profiles WHERE email = ?')
          .bind(userEmail)
          .first<{ id: string; clerk_user_id: string; email: string; is_superadmin: number; subscription_status: string }>();

        if (existingProfileByEmail) {
          console.warn('⚠️ Email already exists in database:', userEmail, 'for clerk_user_id:', existingProfileByEmail.clerk_user_id);
          console.warn('Current clerk_user_id trying to register:', clerkUserId);

          // Aceptar si coincide con clerk_user_id o clerk_user_id_test (entorno dev)
          const existingFull = await c.env.DB
            .prepare('SELECT id, clerk_user_id, clerk_user_id_test, is_superadmin, subscription_status FROM user_profiles WHERE email = ?')
            .bind(userEmail)
            .first<{ id: string; clerk_user_id: string; clerk_user_id_test: string | null; is_superadmin: number; subscription_status: string }>();

          if (existingFull && (existingFull.clerk_user_id === clerkUserId || existingFull.clerk_user_id_test === clerkUserId)) {
            console.log('✅ Matched clerk_user_id or clerk_user_id_test, returning existing profile');
            userProfile = {
              id: existingFull.id,
              is_superadmin: existingFull.is_superadmin,
              subscription_status: existingFull.subscription_status
            };
          } else {
            // Email duplicado con diferente clerk_user_id - NO PERMITIR
            return c.json({
              success: false,
              error: 'Email already registered',
              message: `The email ${userEmail} is already associated with another account. Please use a different email or contact support.`
            }, 409); // Conflict
          }
        } else {
          // No existe perfil con este email, crear uno nuevo
          const { getClerkUserFullName } = await import('../utils/clerk-helpers');
          const fullName = getClerkUserFullName(clerkUser);
          const superAdminEmail = 'admin@neurai.dev';
          const isSuperAdmin = userEmail === superAdminEmail;

          console.log('Creating user_profile for clerk_user_id:', clerkUserId, 'email:', userEmail, 'name:', fullName);

          const profileId = `usr_${Date.now()}_${Math.random().toString(36).substring(7)}`;
          const now = new Date().toISOString();
          // Prueba gratis de 30 días para el sistema POS (tiempo suficiente
          // para que el tendero cargue todo su inventario antes de pagar).
          const trialEnd = new Date();
          trialEnd.setDate(trialEnd.getDate() + 30);

          // Tienda Online gratis durante la prueba (30 días) para todo cliente
          // nuevo: activamos el add-on desde el registro con el mismo
          // vencimiento que el trial. Al vencer, hasStoreAccess() lo apaga solo
          // si el usuario ya paga y no lo renovó (durante el trial sigue
          // accesible por la regla del trial).
          const storeAddonEnd = new Date();
          storeAddonEnd.setDate(storeAddonEnd.getDate() + 30);

          await c.env.DB.prepare(
            `INSERT INTO user_profiles (
              id, clerk_user_id, email, role, full_name, is_superadmin,
              subscription_status, trial_start_date, trial_end_date,
              has_store_addon, store_addon_expires_at, store_enabled,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            profileId,
            clerkUserId,
            userEmail,
            'admin',
            fullName,
            isSuperAdmin ? 1 : 0,
            isSuperAdmin ? 'active' : 'trial',
            isSuperAdmin ? null : now,
            isSuperAdmin ? null : trialEnd.toISOString(),
            // Superadmin no necesita el regalo del add-on; el resto sí.
            isSuperAdmin ? 0 : 1,
            isSuperAdmin ? null : storeAddonEnd.toISOString(),
            isSuperAdmin ? 0 : 1,
            now,
            now
          ).run();

          console.log('User profile created successfully:', profileId);
          userProfile = {
            id: profileId,
            is_superadmin: isSuperAdmin ? 1 : 0,
            subscription_status: isSuperAdmin ? 'active' : 'trial'
          };
        }
      } catch (error) {
        console.error('Error creating user_profile:', error);
        return c.json({
          success: false,
          error: 'Failed to create user profile',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
      }
    }

    // Override tenant.id with user_profile.id for FK compatibility
    tenant.id = userProfile.id;
    // Ensure clerk_user_id is available in tenant object (for user-profiles endpoint)
    (tenant as any).clerk_user_id = clerkUserId;
    // Attach is_superadmin flag to tenant object
    (tenant as any).is_superadmin = userProfile.is_superadmin === 1;

    // Check subscription status (skip for superadmin and team members)
    // Team members don't need their own subscription - they use the owner's subscription
    // También se saltan las rutas de identidad/pago (ver SUBSCRIPTION_EXEMPT_PREFIXES):
    // un usuario expirado tiene que poder leer su perfil y pagar para reactivarse.
    const pathname = new URL(c.req.url).pathname;
    const isExemptPath = isSubscriptionExemptPath(pathname);
    if (userProfile.is_superadmin !== 1 && !isTeamMember && !isExemptPath) {
      const userSubscriptionStatus = effectiveSubscriptionStatus(userProfile);
      if (userSubscriptionStatus !== userProfile.subscription_status) {
        c.executionCtx.waitUntil(markExpired(c.env, userProfile.id));
      }
      if (userSubscriptionStatus === 'expired' || userSubscriptionStatus === 'canceled') {
        return c.json({
          success: false,
          error: 'Subscription required',
          message: 'Your subscription has expired. Please renew to continue.'
        }, 402); // Payment Required
      }
    }

    // If user is a team member, verify the OWNER's subscription instead
    if (isTeamMember && userProfileId && !isExemptPath) {
      const ownerProfile = await c.env.DB
        .prepare('SELECT subscription_status, trial_end_date, next_billing_date FROM user_profiles WHERE id = ?')
        .bind(userProfileId)
        .first<{ subscription_status: string; trial_end_date: string | null; next_billing_date: string | null }>();

      if (ownerProfile) {
        const ownerSubscriptionStatus = effectiveSubscriptionStatus(ownerProfile);
        if (ownerSubscriptionStatus !== ownerProfile.subscription_status) {
          c.executionCtx.waitUntil(markExpired(c.env, userProfileId));
        }
        if (ownerSubscriptionStatus === 'expired' || ownerSubscriptionStatus === 'canceled') {
          return c.json({
            success: false,
            error: 'Store subscription expired',
            message: 'The store owner\'s subscription has expired. Please contact the store owner.'
          }, 402); // Payment Required
        }
      }
    }

    // Attach tenant to context
    c.set('tenant', tenant);
    c.set('clerkUserId', clerkUserId);
    c.set('userProfileId', userProfile.id);

    await next();
  } catch (error) {
    console.error('Auth error:', error);

    // Distinguir un fallo de infraestructura (D1 caído o sin cupo) de un token
    // realmente inválido. Si D1 no responde, el token puede ser perfectamente
    // válido: devolver 401 "Unauthorized" empujaría al usuario a re-loguearse en
    // vano y a ver "sesión inválida" cuando el problema es del servidor. En ese
    // caso respondemos 503 para que el front muestre el error de conexión
    // reintentable (ConnectionErrorModal), no el de suscripción/sesión.
    const message = error instanceof Error ? error.message : String(error);
    const isInfraError =
      message.includes('D1_ERROR') ||
      message.includes('exceeded') ||
      message.includes('row read limit') ||
      message.includes('Network connection lost') ||
      message.includes('storage') ||
      message.includes('Too many API requests');

    if (isInfraError) {
      return c.json({
        success: false,
        error: 'Service unavailable',
        message: 'El servicio no está disponible temporalmente. Intenta de nuevo en un momento.'
      }, 503);
    }

    return c.json({
      success: false,
      error: 'Unauthorized',
      message: 'Token verification failed'
    }, 401);
  }
}

/**
 * Verify Clerk JWT token
 * Returns Clerk user ID if valid, null otherwise
 */
export async function verifyClerkToken(token: string, env: Env): Promise<string | null> {
  try {
    // El issuer (iss) del token indica qué instancia de Clerk lo emitió y, por
    // tanto, dónde está su JWKS. Lo leemos SIN verificar solo para descubrir el
    // issuer; la verificación criptográfica real ocurre en jwtVerify más abajo.
    let issuer: string;
    try {
      const unverified = decodeJwt(token);
      if (!unverified.iss) {
        console.error('Token verification error: missing iss claim');
        return null;
      }
      issuer = unverified.iss.replace(/\/$/, '');
    } catch {
      console.error('Token verification error: malformed JWT');
      return null;
    }

    if (!isAllowedClerkIssuer(issuer, env)) {
      console.error(`Token verification error: untrusted issuer ${issuer}`);
      return null;
    }

    const JWKS = getJWKS(issuer);

    // Verifica firma, expiración (exp) y not-before (nbf), y que el issuer
    // coincida exactamente con el del token (ya validado como confiable).
    const { payload } = await jwtVerify(token, JWKS, { issuer });

    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch (error) {
    console.error('Token verification error:', error);
    return null;
  }
}

/**
 * Middleware to check if user is admin
 */
export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const tenant = c.get('tenant');

  if (!tenant) {
    return c.json({
      success: false,
      error: 'Forbidden',
      message: 'Admin access required'
    }, 403);
  }

  // Check if user has admin role in their user_profile
  // This would require querying the tenant's database
  // For now, we'll assume all tenant owners are admins

  await next();
}

/**
 * Optional middleware - check subscription for specific features
 */
export async function requireActiveSubscription(c: Context<AppEnv>, next: Next) {
  const tenant = c.get('tenant');

  if (!tenant) {
    return c.json({
      success: false,
      error: 'Unauthorized'
    }, 401);
  }

  if (tenant.subscriptionStatus !== 'active' && tenant.subscriptionStatus !== 'trial') {
    return c.json({
      success: false,
      error: 'Subscription required',
      message: 'This feature requires an active subscription'
    }, 402);
  }

  await next();
}
