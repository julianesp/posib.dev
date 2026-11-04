/**
 * Doble de prueba de Cloudflare D1 sobre el SQLite integrado de Node (node:sqlite).
 *
 * D1 es SQLite, así que las rutas del Worker corren contra el esquema real
 * (schema-shared.sql + migraciones) sin tocar la base de producción. Imita las
 * reglas de D1 que importan: `undefined` en un bind es un error y los boolean
 * se guardan como 1/0.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const MIGRATIONS_DIR = path.join(__dirname, '../../../cloudflare-migration');

// Migraciones que tocan las tablas de ventas, productos, clientes, equipo y
// perfil, en el orden en que se aplicaron en producción.
const MIGRATIONS = [
  'migrations/008_create_team_management_tables.sql',
  'migrations/add-unit-selling-fields.sql',
  'migrations/fix-payment-method-nequi.sql',
  'migrations/025_web_order_payment_reference.sql',
  'migrations/027_product_siigo_fields.sql',
  'migrations/031_dian_e_invoicing.sql',
  'migrations/032_partnership.sql',
];

function toSqlValue(value: unknown): SQLInputValue {
  if (value === undefined) {
    throw new Error('D1_TYPE_ERROR: Type undefined is not supported as a bound value');
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value as SQLInputValue;
}

// node:sqlite devuelve objetos sin prototipo; D1 devuelve objetos normales.
const plain = <T>(row: unknown) => ({ ...(row as object) }) as T;

// Los errores de node:sqlite nacen en otro "realm": en Jest `error instanceof
// Error` da false, mientras que en el Worker los de D1 sí son Error. Se
// re-lanzan como Error de este realm (mismo mensaje) para que código como
// isUniqueViolation() se comporte igual que en producción.
function d1Call<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error((error as { message?: string })?.message ?? String(error));
  }
}

class D1PreparedStatementFake {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = []
  ) {}

  bind(...values: unknown[]) {
    return new D1PreparedStatementFake(this.db, this.sql, values.map(toSqlValue));
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = d1Call(() => this.db.prepare(this.sql).get(...this.params));
    if (!row) return null;
    return column ? ((row as Record<string, unknown>)[column] as T) : plain<T>(row);
  }

  async all<T = Record<string, unknown>>() {
    const rows = d1Call(() => this.db.prepare(this.sql).all(...this.params));
    return { success: true, results: rows.map((r) => plain<T>(r)), meta: {} };
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    return d1Call(() => this.runRaw());
  }

  private runRaw() {
    // En un batch, D1 devuelve las filas de las consultas de lectura.
    if (/^\s*(SELECT|WITH)\b/i.test(this.sql)) {
      const rows = this.db.prepare(this.sql).all(...this.params);
      return { success: true, results: rows.map((r) => plain(r)), meta: { changes: 0, last_row_id: 0 } };
    }
    const info = this.db.prepare(this.sql).run(...this.params);
    return {
      success: true,
      results: [],
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
    };
  }
}

export class D1DatabaseFake {
  readonly sqlite: DatabaseSync;

  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    const schema = fs
      .readFileSync(path.join(MIGRATIONS_DIR, 'schema-shared.sql'), 'utf8')
      // schema-shared.sql trae `datetime(\"now\")` (comillas escapadas, SQL inválido)
      // en una tabla; aquí se corrige para poder cargar el resto del esquema.
      .replace(/\\"now\\"/g, "'now'");
    this.sqlite.exec(schema);

    // Las vistas (v_sales_full) impiden recrear `sales` en la migración de Nequi:
    // se quitan y se vuelven a crear al final, como se hizo en producción.
    const views = this.sqlite
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'view'`)
      .all() as { name: string; sql: string }[];
    for (const view of views) this.sqlite.exec(`DROP VIEW ${view.name}`);

    for (const file of MIGRATIONS) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      for (const statement of splitStatements(sql)) {
        try {
          this.sqlite.exec(statement);
        } catch (error) {
          // El esquema base ya trae algunas columnas que luego añadieron las migraciones.
          if (!/duplicate column name/i.test((error as Error).message)) throw error;
        }
      }
    }

    for (const view of views) this.sqlite.exec(view.sql);
  }

  prepare(sql: string) {
    return new D1PreparedStatementFake(this.sqlite, sql);
  }

  // D1 ejecuta el batch como una transacción: si una sentencia falla, ninguna queda.
  async batch(statements: D1PreparedStatementFake[]) {
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map((s) => s.runSync());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  async exec(sql: string) {
    this.sqlite.exec(sql);
    return { count: 0, duration: 0 };
  }

  /** Atajo para sembrar datos en las pruebas. */
  insert(table: string, row: Record<string, unknown>) {
    const columns = Object.keys(row);
    this.sqlite
      .prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
      .run(...Object.values(row).map(toSqlValue));
  }

  /** Atajo para leer una fila en las aserciones. */
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
    const row = this.sqlite.prepare(sql).get(...params.map(toSqlValue));
    return row ? plain<T>(row) : undefined;
  }
}

function splitStatements(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
