import { caution, serve, validate_req_json, HTTP_STATUS_CODE } from 'spooder';
import { format } from 'node:util';
import { db_get_single, db_execute, db_insert } from './db';
import { db_row_clients } from './db/types/clients';
import { db_row_client_sessions } from './db/types/client_sessions';
import type { JsonPrimitive, JsonArray, JsonObject } from 'spooder';

interface ToJson {
	toJSON(): any;
}

type JsonSerializable = JsonPrimitive | JsonObject | JsonArray | ToJson;

type Resolvable<T> = T | Promise<T>;
type BunFile = ReturnType<typeof Bun.file>;
type HandlerReturnType = Resolvable<string | number | BunFile | Response | JsonSerializable | Blob>;

type SessionRequestHandler = (req: Request, url: URL, client_id: number, json?: JsonObject) => HandlerReturnType;

const server = serve(Number(process.env.SERVER_PORT));

// maximum cache life is X * 2, minimum is X.
//const CACHE_SESSION_LIFETIME = 1000 * 60 * 60;
const CACHE_SESSION_LIFETIME = 10000; // testing

type CachedSession = { client_id: number, last_access: number };
const client_session_cache = new Map<string, CachedSession>();

function log(prefix: string, message: string, ...args: unknown[]): void {
	let formatted_message = format('[{' + prefix + '}] ' + message, ...args);
	formatted_message = formatted_message.replace(/\{([^}]+)\}/g, '\x1b[38;5;13m$1\x1b[0m');

	console.log(formatted_message);
}

function default_handler(status_code: number): Response {
	return new Response(HTTP_STATUS_CODE[status_code] as string, { status: status_code });
}

function is_valid_uuid(uuid: string): boolean {
	return uuid.length === 36 && /^[0-9a-f-]+$/.test(uuid);
}

async function generate_session_token(client_id: number): Promise<string> {
	await db_execute('DELETE FROM `client_sessions` WHERE `client_id` = ?', [client_id]);

	const session_token = crypto.randomUUID();
	await db_execute('INSERT INTO `client_sessions` (`session_token`, `client_id`) VALUES(?, ?)', [session_token, client_id]);

	return session_token;
}

async function get_session_client_id(session_token: unknown): Promise<number> {
	if (typeof session_token !== 'string')
		return -1;

	const cached_session = client_session_cache.get(session_token);
	if (cached_session !== undefined) {
		log('dev', 'cache hit for %s', session_token);
		cached_session.last_access = Date.now();
		return cached_session.client_id;
	}

	log('dev', 'cache miss for %s', session_token);

	const session_row = await db_get_single('SELECT `client_id` FROM `client_sessions` WHERE `client_id` = ?', [session_token]) as db_row_client_sessions;
	const client_id = session_row?.client_id ?? -1;

	if (client_id > -1) {
		client_session_cache.set(session_token, {
			client_id,
			last_access: Date.now()
		});
	}

	return client_id;
}

function sweep_client_session_cache() {
	const current_time = Date.now();

	for (const [session_token, session] of client_session_cache)
		if (current_time - session.last_access > CACHE_SESSION_LIFETIME)
			client_session_cache.delete(session_token);

	setTimeout(sweep_client_session_cache, CACHE_SESSION_LIFETIME);
}

setTimeout(sweep_client_session_cache, CACHE_SESSION_LIFETIME);

function validate_session_request(handler: SessionRequestHandler, json_body: boolean = false) {
	return async (req: Request, url: URL) => {
		let json = null;

		if (json_body) {
			// validate content type header
			if (req.headers.get('Content-Type') !== 'application/json')
				return 400; // Bad Request

			json = await req.json();

			// validate json is a plain object
			if (json === null || typeof json !== 'object' || Array.isArray(json))
				return 400; // Bad Request
		}

		const x_session_token = req.headers.get('X-Session-Token');
		const client_id = await get_session_client_id(x_session_token);

		if (client_id === -1)
			return 401; // Unauthorized

		return handler(req, url, client_id, json as JsonObject);
	};
}

function session_get_route(route: string, handler: SessionRequestHandler) {
	server.route(route, validate_session_request(handler), 'GET');
}

function session_post_route(route: string, handler: SessionRequestHandler) {
	server.route(route, validate_session_request(handler, true), 'POST');
}

session_get_route('/api/test', async (req, url, client_id) => {
	return { client_id };
});

server.route('/api/authenticate', validate_req_json(async (req, url, json) => {
	const client_identifier = json.client_identifier;
	const client_key = json.client_key;

	if (typeof client_identifier !== 'string' || typeof client_key !== 'string')
		return 400; // Bad Request

	if (!is_valid_uuid(client_identifier) || !is_valid_uuid(client_key))
		return 400; // Bad Request

	const client_row = await db_get_single('SELECT `id`, `client_key` FROM `clients` WHERE `client_identifier` = ? LIMIT 1', [client_identifier]) as db_row_clients;
	if (client_row === null || client_row.client_key !== client_key)
		return 401; // Unauthorized

	const session_token = await generate_session_token(client_row.id);
	log('client', 'authorized client session for {%s}', client_identifier);

	return { session_token };
}), 'POST');

server.route('/api/register', validate_req_json(async (req, url, json) => {
	const client_key = json.client_key;

	if (typeof client_key !== 'string' || !is_valid_uuid(client_key))
		return 400; // Bad Request

	const client_identifier = crypto.randomUUID();
	const client_id = await db_insert('INSERT INTO `clients` (`client_identifier`, `client_key`) VALUES(?, ?)', [client_identifier, client_key]);

	if (client_id === -1)
		return 500;

	log('client', 'registered new client {%d} [{%s}]', client_id, client_identifier);

	const session_token = await generate_session_token(client_id);
	return { session_token, client_identifier };
}), 'POST');

// caution on slow requests
server.on_slow_request((req, request_time, url) => {
	caution(`Slow request: ${req.method} ${url.pathname}`, { request_time });
}, 500);

// unhandled exceptions and rejections
server.error((err: Error) => {
	caution(err?.message ?? err);
	return default_handler(500);
});

// unhandled response codes.
server.default((req, status_code) => default_handler(status_code));

// source control webhook
if (typeof process.env.GH_WEBHOOK_SECRET === 'string') {
	server.webhook(process.env.GH_WEBHOOK_SECRET, '/internal/webhook', () => {
		setImmediate(async () => {
			await server.stop(false);
			process.exit(0);
		});
		return 200;
	});
} else {
	caution('GH_WEBHOOK_SECRET environment variable not configured');
}