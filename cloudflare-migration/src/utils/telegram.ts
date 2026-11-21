/**
 * Telegram utility using the Bot API.
 * No requiere librerías: solo fetch a api.telegram.org.
 * Documentación: https://core.telegram.org/bots/api
 *
 * El token del bot se obtiene con @BotFather y se guarda como secret del
 * Worker (TELEGRAM_BOT_TOKEN). Ver `wrangler secret put TELEGRAM_BOT_TOKEN`.
 */

const TELEGRAM_API = 'https://api.telegram.org';

export interface TelegramResult {
  success: boolean;
  error?: string;
}

/**
 * Envía un mensaje de texto a un chat de Telegram.
 * `text` admite formato HTML (parse_mode: 'HTML').
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  botToken?: string
): Promise<TelegramResult> {
  try {
    if (!botToken) {
      return { success: false, error: 'TELEGRAM_BOT_TOKEN not configured' };
    }
    if (!chatId) {
      return { success: false, error: 'chatId vacío' };
    }

    const response = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Telegram error:', errorText);
      return { success: false, error: `Telegram API error: ${response.status} - ${errorText}` };
    }

    return { success: true };
  } catch (error) {
    console.error('Error enviando mensaje de Telegram:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Escapa texto para insertarlo de forma segura en un mensaje con parse_mode HTML.
 * Telegram solo permite un subconjunto de tags; cualquier <, >, & del contenido
 * dinámico (p. ej. el nombre de un producto) debe escaparse.
 */
export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Devuelve todos los chat IDs de un tenant: el del dueño más los destinatarios
 * adicionales activos (empleada, etc.). Deduplicado.
 */
export async function getTenantChatIds(
  db: D1Database,
  tenantId: string,
  ownerChatId: string | null
): Promise<string[]> {
  const ids = new Set<string>();
  if (ownerChatId) ids.add(String(ownerChatId));

  const recipients = await db
    .prepare(
      `SELECT chat_id FROM telegram_recipients
       WHERE tenant_id = ? AND chat_id IS NOT NULL AND enabled = 1`
    )
    .bind(tenantId)
    .all();

  for (const r of (recipients.results as { chat_id?: string }[]) || []) {
    if (r.chat_id) ids.add(String(r.chat_id));
  }
  return Array.from(ids);
}

/**
 * Envía un mensaje a varios chats. Devuelve cuántos se enviaron con éxito.
 */
export async function sendToChats(
  chatIds: string[],
  message: string,
  botToken?: string
): Promise<number> {
  let sent = 0;
  for (const chatId of chatIds) {
    const result = await sendTelegramMessage(chatId, message, botToken);
    if (result.success) sent++;
  }
  return sent;
}

/**
 * Envía un aviso interno a los superadmins con Telegram conectado (y no
 * desactivado). Best-effort: nunca lanza. Devuelve cuántos se enviaron.
 */
export async function notifySuperadmins(
  db: D1Database,
  text: string,
  botToken?: string
): Promise<number> {
  try {
    if (!botToken) {
      console.warn('notifySuperadmins: TELEGRAM_BOT_TOKEN no configurado');
      return 0;
    }
    const admins = await db
      .prepare(
        `SELECT telegram_chat_id FROM user_profiles
         WHERE is_superadmin = 1 AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
           AND COALESCE(telegram_enabled, 1) != 0`
      )
      .all<{ telegram_chat_id: string }>();
    const chatIds = (admins.results || []).map((r) => String(r.telegram_chat_id));
    if (chatIds.length === 0) {
      console.warn('notifySuperadmins: ningún superadmin tiene Telegram vinculado');
      return 0;
    }
    return await sendToChats(chatIds, text, botToken);
  } catch (error) {
    console.error('notifySuperadmins error:', error);
    return 0;
  }
}
