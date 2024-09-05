import { db_init_schema_mysql_pool, caution } from 'spooder';
import type { RowDataPacket } from 'mysql2';

const db_pool = await db_init_schema_mysql_pool({
	host: process.env.DB_HOST,
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_DATABASE,
	connectionLimit: 5
}, './db/schema');

export { db_pool as db };

type PoolConnection = ReturnType<typeof db_pool.getConnection> extends Promise<infer T> ? T : never;
type db = typeof db_pool | PoolConnection;

export async function db_execute(sql: string, values: any = []): Promise<void> {
	try {
		await db_pool.query(sql, values);
	} catch (error) {
		caution('sql: db_execute failed', { error });
	}
}

export async function db_get_all(sql: string, values: any = []): Promise<RowDataPacket[]> {
	try {
		const [rows] = await db_pool.execute(sql, values);
		return rows as RowDataPacket[];
	} catch (error) {
		caution('sql: db_get_all failed', { error });
		return [];
	}
}

export async function db_get_single(sql: string, values: any = []): Promise<RowDataPacket|null> {
	const rows = await db_get_all(sql, values);
	return rows[0] ?? null;
}

export async function db_insert(sql: string, values: any = []): Promise<number> {
	try {
		const [result] = await db_pool.query(sql, values);

		// @ts-ignore result is ResultSetHeader, but ts doesn't like that
		return result?.insertId ?? -1;
	} catch (error) {
		caution('sql: db_insert failed', { error });
		return -1;
	}
};