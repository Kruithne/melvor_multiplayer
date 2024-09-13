import { caution, serve, validate_req_json, HTTP_STATUS_CODE } from 'spooder';
import { format } from 'node:util';
import { db_get_single, db_execute, db_insert, db_count, db_exists } from './db';
import { db_row_clients } from './db/types/clients';
import { db_row_client_sessions } from './db/types/client_sessions';
import type { JsonPrimitive, JsonArray, JsonObject, ServerSentEventClient } from 'spooder';

interface ToJson {
	toJSON(): any;
}

type JsonSerializable = JsonPrimitive | JsonObject | JsonArray | ToJson;

type Resolvable<T> = T | Promise<T>;
type BunFile = ReturnType<typeof Bun.file>;
type HandlerReturnType = Resolvable<string | number | BunFile | Response | JsonSerializable | Blob>;

type SessionRequestHandler = (req: Request, url: URL, client_id: number, json: JsonObject) => HandlerReturnType;

let is_closing = false;
const server = serve(Number(process.env.SERVER_PORT));
const pipe_clients = new Set<WebSocket>();

// maximum cache life is X * 2, minimum is X.
const CACHE_SESSION_LIFETIME = 1000 * 60 * 60;

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

async function is_friend_code_taken(friend_code: string): Promise<boolean> {
	return db_exists('SELECT 1 FROM `clients` WHERE `friend_code` = ? LIMIT 1', [friend_code]);
}

function is_valid_friend_code(friend_code: string): boolean {
	return /^[0-9]{3}-[0-9]{3}-[0-9]{3}$/.test(friend_code);
}

function validate_display_name(display_name: unknown): string {
	if (typeof display_name === 'string') {
		const trimmed = display_name.trim();
		if (trimmed.length > 0 && trimmed.length <= 20)
			return trimmed;
	}
	return 'Unknown Idler';
}

async function generate_friend_code(): Promise<string> {
	const chunk = () => Math.floor(Math.random() * 900) + 100;
	const code = () => chunk() + '-' + chunk() + '-' + chunk();

	let generated_code = code();
	while (await is_friend_code_taken(generated_code))
		generated_code = code();

	return generated_code;
}

async function generate_session_token(client_id: number): Promise<string> {
	await db_execute('DELETE FROM `client_sessions` WHERE `client_id` = ?', [client_id]);

	const session_token = crypto.randomUUID();
	await db_execute('INSERT INTO `client_sessions` (`session_token`, `client_id`) VALUES(?, ?)', [session_token, client_id]);

	return session_token;
}

async function get_user_id_from_friend_code(friend_code: string): Promise<number> {
	const user_row = await db_get_single('SELECT `id` FROM `clients` WHERE `friend_code` = ?', [friend_code]) as db_row_clients;
	return user_row?.id ?? -1;
}

async function get_session_client_id(session_token: unknown): Promise<number> {
	if (typeof session_token !== 'string')
		return -1;

	const cached_session = client_session_cache.get(session_token);
	if (cached_session !== undefined) {		
		cached_session.last_access = Date.now();
		return cached_session.client_id;
	}

	const session_row = await db_get_single('SELECT `client_id` FROM `client_sessions` WHERE `session_token` = ?', [session_token]) as db_row_client_sessions;
	const client_id = session_row?.client_id ?? -1;

	if (client_id > -1) {
		client_session_cache.set(session_token, {
			client_id,
			last_access: Date.now()
		});
	}

	return client_id;
}

function send_pipe_event(event_name: string, event_data: JsonSerializable) {
	const json_event_data = JSON.stringify(event_data);
	for (const client of pipe_clients)
		client.send(json_event_data);
}

setInterval(() => {
	send_pipe_event('test_event', { random: Math.random() });
}, 1000);

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

session_post_route('/api/friends/add', async (req, url, client_id, json) => {
	const friend_code = json.friend_code;
	if (typeof friend_code !== 'string')
		return 400; // Bad Request

	if (!is_valid_friend_code(friend_code))
		return { error_lang: 'MOD_KMM_INVALID_FRIEND_CODE_ERR' };

	const friend_user_id = await get_user_id_from_friend_code(friend_code);
	if (friend_user_id === -1)
		return { error_lang: 'MOD_KMM_UNKNOWN_FRIEND_CODE_ERR' };

	if (friend_user_id === client_id)
		return { error_lang: 'MOD_KMM_NO_SELF_LOVE_ERR' };

	if (!(await db_exists('SELECT 1 FROM `friend_requests` WHERE `client_id` = ? AND `friend_id` = ? LIMIT 1', [client_id, friend_user_id])))
		await db_insert('INSERT INTO `friend_requests` (`client_id`, `friend_id`) VALUES(?, ?)', [client_id, friend_user_id]);

	return { success: true } as JsonSerializable;
});

server.route('/api/authenticate', validate_req_json(async (req, url, json) => {
	server.allow_slow_request(req);
	await Bun.sleep(1000);

	const client_identifier = json.client_identifier;
	const client_key = json.client_key;

	if (typeof client_identifier !== 'string' || typeof client_key !== 'string')
		return 400; // Bad Request

	if (!is_valid_uuid(client_identifier) || !is_valid_uuid(client_key))
		return 400; // Bad Request

	const client_row = await db_get_single('SELECT `id`, `client_key` FROM `clients` WHERE `client_identifier` = ? LIMIT 1', [client_identifier]) as db_row_clients;
	if (client_row === null || client_row.client_key !== client_key)
		return 401; // Unauthorized

	const display_name = validate_display_name(json.display_name);
	await db_execute('UPDATE `clients` SET `display_name` = ? WHERE `id` = ?', [display_name, client_row.id]);

	const session_token = await generate_session_token(client_row.id);
	log('client', 'authorized client session for {%s}', client_identifier);

	return { session_token, friend_code: client_row.friend_code };
}), 'POST');

server.route('/api/register', validate_req_json(async (req, url, json) => {
	server.allow_slow_request(req);
	await Bun.sleep(1000);

	const client_key = json.client_key;

	if (typeof client_key !== 'string' || !is_valid_uuid(client_key))
		return 400; // Bad Request

	const friend_code = await generate_friend_code();
	const display_name = validate_display_name(json.display_name);

	const client_identifier = crypto.randomUUID();
	const client_id = await db_insert('INSERT INTO `clients` (`client_identifier`, `client_key`, `friend_code`, `display_name`) VALUES(?, ?, ?, ?)', [client_identifier, client_key, friend_code, display_name]);

	if (client_id === -1)
		return 500;

	log('client', 'registered new client {%d} [{%s}]', client_id, client_identifier);

	const session_token = await generate_session_token(client_id);
	return { session_token, client_identifier, friend_code };
}), 'POST');

server.websocket('/pipe/events', {
	accept: async (req) => {
		if (is_closing)
			return false;
		
		const x_session_token = req.headers.get('sec-websocket-protocol');
		const client_id = await get_session_client_id(x_session_token);

		console.log({
			x_session_token,
			client_id
		});

		if (client_id === -1)
			return false;

		return { client_id };
	},

	open: (ws) => {
		pipe_clients.add(ws);
		console.log(ws.data);
	},

	close: (ws, code, reason) => {
		pipe_clients.delete(ws);
	}
});

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
			is_closing = true;

			// close all websockets
			for (const client of pipe_clients)
				client.close(1012); // Service Restart

			await server.stop(false);
			process.exit(0);
		});
		return 200;
	});
} else {
	caution('GH_WEBHOOK_SECRET environment variable not configured');
}