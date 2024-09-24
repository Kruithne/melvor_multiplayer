// #region IMPORTS
import { caution, serve, validate_req_json, HTTP_STATUS_CODE } from 'spooder';
import { format } from 'node:util';
import { db_get_single, db_execute, db_insert, db_exists, db_get_all } from './db';
import type { JsonPrimitive, JsonArray, JsonObject } from 'spooder';
import { AVAILABLE_CAMPAIGNS } from './campaign_data';
import type { CampaignData } from './campaign_data';
import type * as db_row from './db/types/db_types';
// #endregion

// #region TYPES
interface ToJson {
	toJSON(): any;
}

type JsonSerializable = JsonPrimitive | JsonObject | JsonArray | ToJson;

type Resolvable<T> = T | Promise<T>;
type BunFile = ReturnType<typeof Bun.file>;
type HandlerReturnType = Resolvable<string | number | BunFile | Response | JsonSerializable | Blob>;

type SessionRequestHandler = (req: Request, url: URL, client_id: number, json: JsonObject) => HandlerReturnType;
type CachedSession = { client_id: number, last_access: number };

type ActiveTrade = {
	trade_id: number;
	state: number;
	attending_id: number;
}

type FriendRequest = {
	display_name: string;
	request_id: number;
}

enum GiftFlags {
	Returned = 1 << 0
}

type TransferItem = {
	id: string;
	qty: number;
}
// #endregion

// #region CONSTANTS
const DEFAULT_USER_ICON_ID = 'melvorF:Fire_Acolyte_Wizard_Hat';
const MAX_TRANSFER_ITEM_COUNT = 32;

// maximum cache life is X * 2, minimum is X.
const CACHE_SESSION_LIFETIME = 1000 * 60 * 60; // 1 hour

// time between data cache sweeps
const CACHE_RESET_INTERVAL = 1000 * 60 * 60 * 24; // 24 hours

// time between players taking charity items
const CHARITY_TIMEOUT = 1000 * 60 * 60 * 24; // 24 hours

const CAMPAIGN_MAX_SOLO_CONTRIB_FAC = 0.25;
const CAMPAIGN_ITEM_MIN = 10;
const CAMPAIGN_ITEM_MAX = 50;
const CAMPAIGN_ITEM_SCALE = 1000000;
const CAMPAIGN_RESTART_TIMER = 1000 * 60 * 60 * 12; // 12 hours
// #endregion

// #region GLOBALS
const server = serve(Number(process.env.SERVER_PORT));

const client_session_cache = new Map<string, CachedSession>();

const friend_request_cache = new Map<number, FriendRequest[]>();
const gift_cache = new Map<number, number[]>();
const display_name_cache = new Map<number, string>();

const trade_cache = new Map<number, ActiveTrade>(); // trade_id to ActiveTrade
const trade_player_cache = new Map<number, number[]>(); // client_id to trade_id[]
const resolved_trade_cache = new Map<number, number[]>(); // client_id to trade_id[]

let campaign_active_id: number = 0;
let campaign_active_campaign_id: string = '';
let campaign_active_item: string = '';
let campaign_item_total: number = 0;
let campaign_item_current: number = 0;
let campaign_current_pct: number = 0;
let campaign_next_active_timestamp: number = 0;
// #endregion

// #region COMMON FN
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

function remove_player_cache_entry(cache: Map<number, number[]>, client_id: number, item_id: number) {
	const cached_entries = cache.get(client_id);
	if (cached_entries)
		cache.set(client_id, cached_entries.filter(e => e !== item_id));
}

function validate_item_array(items: unknown, allow_modded = true) {
	if (!Array.isArray(items))
		return false;

	for (const item of items) {
		if (typeof item !== 'object' || item === null || Array.isArray(item))
			return false;

		// @ts-ignore
		if (typeof item.id !== 'string' || typeof item.qty !== 'number')
			return false;

		if (item.qty <= 0)
			return false;

		if (!allow_modded && !item.id.startsWith('melvor'))
			return false;
	}

	return true;
}

function array_random(arr: Array<unknown>) {
	return arr[Math.floor(Math.random() * arr.length)];
}
// #endregion

// #region MAINTENANCE
function sweep_data_caches() {
	friend_request_cache.clear();
	gift_cache.clear();
	display_name_cache.clear();

	trade_cache.clear();
	trade_player_cache.clear();
	resolved_trade_cache.clear();

	setTimeout(sweep_data_caches, CACHE_RESET_INTERVAL);
}

function sweep_client_session_cache() {
	const current_time = Date.now();

	for (const [session_token, session] of client_session_cache)
		if (current_time - session.last_access > CACHE_SESSION_LIFETIME)
			client_session_cache.delete(session_token);

	setTimeout(sweep_client_session_cache, CACHE_SESSION_LIFETIME);
}

setTimeout(sweep_client_session_cache, CACHE_SESSION_LIFETIME);
setTimeout(sweep_data_caches, CACHE_RESET_INTERVAL);
// #endregion

// #region CAMPAIGN
async function start_new_campaign() {
	const campaign_data = array_random(AVAILABLE_CAMPAIGNS) as CampaignData;

	campaign_active_campaign_id = campaign_data.id;
	campaign_active_item = array_random(campaign_data.items) as string;
	campaign_next_active_timestamp = 0;

	campaign_item_total = Math.floor(Math.random() * (CAMPAIGN_ITEM_MAX - CAMPAIGN_ITEM_MIN) + CAMPAIGN_ITEM_MIN) * CAMPAIGN_ITEM_SCALE;
	campaign_item_current = 0;
	campaign_current_pct = 0;

	log('campaign', 'started new campaign {%s} {%s} {%s}', campaign_active_campaign_id, campaign_active_item, campaign_item_total);

	campaign_active_id = await db_insert(
		'INSERT INTO `campaign_state` (campaign_id, item_id, item_amount) VALUES(?, ?, ?)',
		[campaign_active_campaign_id, campaign_active_item, campaign_item_total]
	);
}

async function update_campaign_progress() {
	campaign_current_pct = campaign_item_current / campaign_item_total;

	if (campaign_item_current >= campaign_item_total)
		return finalize_campaign();
}

async function finalize_campaign() {
	campaign_active_id = 0;
	campaign_next_active_timestamp = Date.now() + CAMPAIGN_RESTART_TIMER;

	await db_execute('UPDATE `campaign_state` SET `complete` = 1, `campaign_next` = ?', [campaign_next_active_timestamp]);
}

async function load_campaign_state() {
	const state = await db_get_single('SELECT * FROM `campaign_state` ORDER BY `id` DESC LIMIT 1') as db_row.campaign_state;
	if (state === null)
		return start_new_campaign();

	if (state.complete === 1) {
		campaign_next_active_timestamp = state.campaign_next;
		return check_campaign_timestamp();
	}

	campaign_active_id = state.id;
	campaign_active_campaign_id = state.campaign_id;
	campaign_active_item = state.item_id;
	campaign_item_total = state.item_amount;
	campaign_item_current = state.item_current;

	update_campaign_progress();

	log('campaign', 'loaded campaign state: {%s} {%s} {%s}/{%s}', campaign_active_campaign_id, campaign_active_item, campaign_item_current, campaign_item_total);
}

async function check_campaign_timestamp() {
	if (Date.now() >= campaign_next_active_timestamp)
		return start_new_campaign();
}

function get_campaign_progress() {
	return {
		active: campaign_active_id > 0,
		pct: campaign_current_pct
	};
}

load_campaign_state();
// #endregion

// #region FRIEND CODE
async function is_friend_code_taken(friend_code: string): Promise<boolean> {
	return db_exists('SELECT 1 FROM `clients` WHERE `friend_code` = ? LIMIT 1', [friend_code]);
}

function is_valid_friend_code(friend_code: string): boolean {
	return /^[0-9]{3}-[0-9]{3}-[0-9]{3}$/.test(friend_code);
}

async function generate_friend_code(): Promise<string> {
	const chunk = () => Math.floor(Math.random() * 900) + 100;
	const code = () => chunk() + '-' + chunk() + '-' + chunk();

	let generated_code = code();
	while (await is_friend_code_taken(generated_code))
		generated_code = code();

	return generated_code;
}

async function get_user_id_from_friend_code(friend_code: string): Promise<number> {
	const user_row = await db_get_single('SELECT `id` FROM `clients` WHERE `friend_code` = ?', [friend_code]) as db_row.clients;
	return user_row?.id ?? -1;
}
// #endregion

// #region DISPLAY NAME FN
function validate_display_name(display_name: unknown): string {
	if (typeof display_name === 'string') {
		const trimmed = display_name.trim();
		if (trimmed.length > 0 && trimmed.length <= 20)
			return trimmed;
	}
	return 'Unknown Idler';
}

async function get_client_display_name(client_id: number): Promise<string> {
	const cached = display_name_cache.get(client_id);
	if (cached !== undefined)
		return cached;

	const client = await db_get_single('SELECT `display_name` FROM `clients` WHERE `id` = ?', [client_id]) as db_row.clients;
	if (client !== null) {
		display_name_cache.set(client_id, client.display_name);
		return client.display_name;
	}

	return 'Unknown Idler';
}
// #endregion

// #region FRIEND REQUESTS
async function get_friend_requests(client_id: number): Promise<FriendRequest[]> {
	const cached_entries = friend_request_cache.get(client_id);
	if (cached_entries)
		return cached_entries;

	const result = await db_get_all('SELECT `request_id`, `friend_id` FROM `friend_requests` WHERE `client_id` = ?', [client_id]) as db_row.friend_requests[];
	const requests = [];

	for (const row of result) {
		requests.push({
			display_name: await get_client_display_name(row?.friend_id as number),
			request_id: row?.request_id ?? -1
		});
	}

	friend_request_cache.set(client_id, requests);

	return requests;
}

async function friend_request_exists(client_id: number, friend_id: number): Promise<boolean> {
	return await db_exists('SELECT 1 FROM `friend_requests` WHERE `client_id` = ? AND `friend_id` = ?', [client_id, friend_id]);
}

async function create_friend_request(client_id: number, friend_id: number) {
	const request_id = await db_insert('INSERT INTO `friend_requests` (`client_id`, `friend_id`) VALUES(?, ?)', [client_id, friend_id]);

	friend_request_cache.get(client_id)?.push({
		display_name: await get_client_display_name(friend_id),
		request_id,
	});
}

async function get_friend_request(request_id: number): Promise<db_row.friend_requests> {
	return await db_get_single('SELECT `request_id`, `client_id`, `friend_id` FROM `friend_requests` WHERE `request_id` = ?', [request_id]) as db_row.friend_requests;
}

async function delete_friend_request(request: db_row.friend_requests) {
	if (request === null)
		return;

	const cached = friend_request_cache.get(request.client_id);
	if (cached !== undefined) {
		const index = cached.findIndex(entry => entry.request_id === request.request_id);
		if (index !== -1)
			cached.splice(index, 1);
	}

	await db_execute('DELETE FROM `friend_requests` WHERE `request_id` = ?', [request.request_id]);
}
// #endregion

// #region FRIENDS
async function friendship_exists(client_id_a: number, client_id_b: number): Promise<boolean> {
	return await db_exists('SELECT 1 FROM `friends` WHERE (`client_id_a` = ? AND `client_id_b` = ?) OR (`client_id_a` = ? AND `client_id_b` = ?)', [client_id_a, client_id_b, client_id_b, client_id_a]);
}

async function create_friendship(client_id_a: number, client_id_b: number) {
	await db_execute('INSERT INTO `friends` (`client_id_a`, `client_id_b`) VALUES(?, ?)', [client_id_a, client_id_b]);
}

async function get_friends(client_id: number) {
	return await db_get_all('SELECT c.`id` AS `friend_id`, c.`display_name`, c.`icon_id` FROM `friends` JOIN `clients` AS c ON c.`id` = IF(`client_id_a` = ?, `client_id_b`, `client_id_a`) WHERE `client_id_a` = ? OR `client_id_b` = ?', [client_id, client_id, client_id]);
}

async function delete_friend(client_id: number, friend_id: number) {
	await db_execute('DELETE FROM `friends` WHERE (`client_id_a` = ? AND `client_id_b` = ?) OR (`client_id_a` = ? AND `client_id_b` = ?)', [client_id, friend_id, friend_id, client_id]);
}
// #endregion

// #region GIFT FN
async function has_pending_gift(client_id: number, recipient_id: number) {
	return await db_exists('SELECT 1 FROM `gifts` WHERE `client_id` = ? AND `sender_id` = ? LIMIT 1', [recipient_id, client_id]);
}

async function send_gift(client_id: number, recipient_id: number, items: TransferItem[]) {
	const gift_id = await db_insert('INSERT INTO `gifts` (`client_id`, `sender_id`) VALUES(?, ?)', [recipient_id, client_id]);

	gift_cache.get(recipient_id)?.push(gift_id);

	for (const item of items)
		await db_execute('INSERT INTO `gift_items` (`gift_id`, `item_id`, `qty`) VALUES(?, ?, ?)', [gift_id, item.id, item.qty]);
}

async function get_gift(gift_id: number) {
	return await db_get_single('SELECT * FROM `gifts` WHERE `gift_id` = ? LIMIT 1', [gift_id]) as db_row.gifts;
}

async function get_gift_items(gift_id: number) {
	return await db_get_all('SELECT `id`, `item_id`, `qty` FROM `gift_items` WHERE `gift_id` = ?', [gift_id]) as db_row.gift_items[];
}

async function get_client_gifts(client_id: number) {
	const cached_entries = gift_cache.get(client_id);
	if (cached_entries)
		return cached_entries;

	const result = await db_get_all('SELECT `gift_id` FROM `gifts` WHERE `client_id` = ?', [client_id]) as db_row.gifts[];
	const gift_ids = result.map(row => row?.gift_id) as number[];

	gift_cache.set(client_id, gift_ids);

	return gift_ids;
}

async function delete_gift(gift: db_row.gifts) {
	if (!gift)
		return;

	remove_player_cache_entry(gift_cache, gift.client_id, gift.gift_id);

	await db_execute('DELETE FROM `gifts` WHERE `gift_id` = ?', [gift.gift_id]);
	await db_execute('DELETE FROM `gift_items` WHERE `gift_id` = ?', [gift.gift_id]);
}

async function return_gift(gift: db_row.gifts) {
	if (!gift)
		return;

	remove_player_cache_entry(gift_cache, gift.client_id, gift.gift_id);
	gift_cache.get(gift.sender_id)?.push(gift.gift_id);

	await db_execute(
		'UPDATE `gifts` SET `client_id` = ?, `sender_id` = ?, `flags` = `flags` | ? WHERE `gift_id` = ?',
		[gift.sender_id, gift.client_id, GiftFlags.Returned, gift.gift_id]
	);
}
// #endregion

// #region TRADE FN
async function trade_exists(sender_id: number, recipient_id: number) {
	return await db_exists('SELECT 1 FROM `trade_offers` WHERE `sender_id` = ? AND `recipient_id` = ? LIMIT 1', [sender_id, recipient_id]);
}

async function get_client_trades(client_id: number) {
	const cached_entries = trade_player_cache.get(client_id);
	if (cached_entries)
		return cached_entries;

	const result = await db_get_all('SELECT `trade_id` FROM `trade_offers` WHERE `sender_id` = ? OR `recipient_id` = ?', [client_id, client_id]) as db_row.trade_offers[];
	const trade_ids = result.map(row => row?.trade_id) as number[];

	trade_player_cache.set(client_id, trade_ids);

	return trade_ids;
}

async function get_trade_offer_meta(trade_id: number) {
	const cached = trade_cache.get(trade_id);
	if (cached)
		return cached;

	const result = await db_get_single('SELECT `attending_id`, `state` FROM `trade_offers` WHERE `trade_id` = ?', [trade_id]) as db_row.trade_offers;

	if (result)
		trade_cache.set(trade_id, result as ActiveTrade);

	return result;
}

async function get_trade_offer(trade_id: number) {
	return await db_get_single('SELECT * FROM `trade_offers` WHERE `trade_id` = ? LIMIT 1', [trade_id]) as db_row.trade_offers;
}

async function get_resolved_trade_offer(trade_id: number) {
	return await db_get_single('SELECT * FROM `resolved_trade_offers` WHERE `trade_id` = ? LIMIT 1', [trade_id]) as db_row.resolved_trade_offers;
}

async function get_trade_items(trade_id: number) {
	return await db_get_all('SELECT `id`, `item_id`, `qty`, `counter` FROM `trade_items` WHERE `trade_id` = ?', [trade_id]) as db_row.gift_items[];
}

async function create_resolved_trade(trade_id: number, client_id: number, sender_id: number, declined: boolean) {
	await db_execute(
		'INSERT INTO `resolved_trade_offers` (trade_id, client_id, sender_id, declined) VALUES(?, ?, ?, ?)',
		[trade_id, client_id, sender_id, declined ? 1 : 0]
	);

	resolved_trade_cache.get(client_id)?.push(trade_id);
}

async function get_client_resolved_trades(client_id: number) {
	const cached_entries = resolved_trade_cache.get(client_id);
	if (cached_entries)
		return cached_entries;

	const result = await db_get_all('SELECT `trade_id` FROM `resolved_trade_offers` WHERE `client_id` = ?', [client_id]) as db_row.resolved_trade_offers[];
	const trade_ids = result.map(row => row?.trade_id) as number[];

	resolved_trade_cache.set(client_id, trade_ids);

	return trade_ids;
}
// #endregion

// #region SESSIONS
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
		cached_session.last_access = Date.now();
		return cached_session.client_id;
	}

	const session_row = await db_get_single('SELECT `client_id` FROM `client_sessions` WHERE `session_token` = ?', [session_token]) as db_row.client_sessions;
	const client_id = session_row?.client_id ?? -1;

	if (client_id > -1) {
		client_session_cache.set(session_token, {
			client_id,
			last_access: Date.now()
		});
	}

	return client_id;
}

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
// #endregion

// #region ROUTES CAMPAIGN
session_get_route('/api/campaign/info', async (req, url, client_id) => {
	// todo: include campaign history in this endpoint.

	if (campaign_active_id > 0) {
		return {
			active: true,
			campaign_id: campaign_active_campaign_id,
			item_id: campaign_active_item,
			item_total: campaign_item_total
		} as JsonSerializable;
	} else {
		return {
			active: false,
			next_campaign: campaign_next_active_timestamp
		} as JsonSerializable;
	}
});
// #endregion

// #region ROUTES CHARITY
session_get_route('/api/charity/contents', async (req, url, client_id) => {
	return {
		items: await db_get_all('SELECT `item_id` as `id`, `qty` FROM `charity_items` LIMIT 78')
	};
});

session_post_route('/api/charity/take', async (req, url, client_id, json) => {
	const item_id = json.item_id;
	if (typeof item_id !== 'string')
		return 400; // Bad Request

	const current_time = Date.now();
	const client_row = await db_get_single('SELECT `last_charity`, `last_bonus_charity` FROM `clients` WHERE `id` = ?', [client_id]) as db_row.clients;
	if (client_row === null)
		return 400; // Bad Request

	const last_charity_cooling_down = client_row.last_charity + CHARITY_TIMEOUT > current_time;
	const last_charity_bonus_cooling_down = client_row.last_bonus_charity + CHARITY_TIMEOUT > current_time;

	if (last_charity_cooling_down && last_charity_bonus_cooling_down)
		return { error_lang: 'MOD_KMM_CHARITY_TIMEOUT', timeout: client_row.last_charity, timeout_bonus: client_row.last_bonus_charity };

	const item_entry = await db_get_single('SELECT `qty` FROM `charity_items` WHERE `item_id` = ?', [item_id]) as db_row.charity_items;
	if (item_entry === null)
		return { error_lang: 'MOD_KMM_CHARITY_TAKEN' };

	if (last_charity_cooling_down) {
		await db_execute('UPDATE `clients` SET `last_bonus_charity` = ? WHERE `id` = ?', [current_time, client_id]);
		client_row.last_bonus_charity = current_time;
	} else {
		await db_execute('UPDATE `clients` SET `last_charity` = ? WHERE `id` = ?', [current_time, client_id]);
		client_row.last_charity = current_time;
	}

	await db_execute('DELETE FROM `charity_items` WHERE `item_id` = ?', [item_id]);

	return {
		success: true,
		item_qty: item_entry.qty,
		timeout: client_row.last_charity,
		timeout_bonus: client_row.last_bonus_charity
	} as JsonSerializable;
});

session_post_route('/api/charity/donate', async (req, url, client_id, json) => {
	const items = json.items as TransferItem[];
	if (!validate_item_array(items, false))
		return 400; // Bad Request

	for (const item of items)
		await db_execute('INSERT INTO `charity_items` (`item_id`, `qty`) VALUES(?, ?) ON DUPLICATE KEY UPDATE `qty` = `qty` + ?', [item.id, item.qty, item.qty]);

	return { success: true };
});
// #endregion

// #region ROUTES TRANSFER
session_post_route('/api/transfers/get_contents', async (req, url, client_id, json) => {
	const gift_ids = json.gift_ids;
	if (!Array.isArray(gift_ids))
		return 400; // Bad Request

	// check ids first, no point hitting db for an invalid request
	for (const gift_id of gift_ids)
		if (typeof gift_id !== 'number')
			return 400; // Bad request

	const gift_results = {} as Record<number, object>;
	for (const gift_id of gift_ids as number[]) {
		const gift = await get_gift(gift_id);
		if (!gift || gift.client_id !== client_id)
			continue;

		gift_results[gift_id] = {
			items: await get_gift_items(gift_id) ?? [],
			sender_name: await get_client_display_name(gift.sender_id),
			flags: gift.flags
		};
	}

	const trade_ids = json.trade_ids;
	if (!Array.isArray(trade_ids))
		return 400; // Bad Request

	// check ids first, no point hitting db for an invalid request
	for (const trade_id of trade_ids)
		if (typeof trade_id !== 'number')
			return 400; // Bad request

	const trade_results = {} as Record<number, object>;
	for (const trade_id of trade_ids as number[]) {
		const trade_offer = await get_trade_offer(trade_id);
		if (!trade_offer || (trade_offer.sender_id !== client_id && trade_offer.recipient_id !== client_id))
			continue;

		const other_player_id = trade_offer.sender_id === client_id ? trade_offer.recipient_id : trade_offer.sender_id;

		trade_results[trade_id] = {
			items: await get_trade_items(trade_id) ?? [],
			other_player: await get_client_display_name(other_player_id)
		};
	}

	const resolved_trade_ids = json.resolved_trade_ids;
	if (!Array.isArray(resolved_trade_ids))
		return 400; // Bad Request

	for (const trade_id of resolved_trade_ids)
		if (typeof trade_id !== 'number')
			return 400; // Bad Request

	const resolved_trade_results = {} as Record<number, object>;
	for (const trade_id of resolved_trade_ids as number[]) {
		const trade_offer = await get_resolved_trade_offer(trade_id);
		if (!trade_offer || trade_offer.client_id !== client_id)
			continue;

		resolved_trade_results[trade_id] = {
			items: await get_trade_items(trade_id) ?? [],
			declined: trade_offer.declined === 1,
			other_player: await get_client_display_name(trade_offer.sender_id)
		};
	}

	return {
		gifts: gift_results,
		trades: trade_results,
		resolved_trades: resolved_trade_results
	} as JsonSerializable;
});
// #endregion

// #region ROUTES TRADE
session_post_route('/api/trade/resolve', async (req, url, client_id, json) => {
	const trade_id = json.trade_id;
	if (typeof trade_id !== 'number')
		return 400; // Bad Request

	const trade = await get_resolved_trade_offer(trade_id);
	if (!trade || trade.client_id !== client_id)
		return 400; // Bad Request

	await db_execute('DELETE FROM `resolved_trade_offers` WHERE `client_id` = ?', [client_id]);
	await db_execute('DELETE FROM `trade_items` WHERE `trade_id` = ?', [trade_id]);

	return { success: true };
});

session_post_route('/api/trade/counter', async (req, url, client_id, json) => {
	const trade_id = json.trade_id;
	if (typeof trade_id !== 'number')
		return 400; // Bad Request

	const trade = await get_trade_offer(trade_id);
	if (!trade || trade.recipient_id !== client_id)
		return 400; // Bad Request

	const items = json.items as TransferItem[];
	if (!validate_item_array(items))
		return 400; // Bad Request;

	for (const item of items) {
		await db_execute(
			'INSERT INTO `trade_items` (trade_id, item_id, qty, counter) VALUES(?, ?, ?, 1)',
			[trade_id, item.id, item.qty]
		);
	}

	// sender becomes the attending player
	await db_execute('UPDATE `trade_offers` SET `state` = 1, `attending_id` = ? WHERE `trade_id` = ? LIMIT 1', [trade.sender_id, trade_id]);

	const cached_meta = trade_cache.get(trade_id);
	if (cached_meta) {
		cached_meta.attending_id = trade.sender_id;
		cached_meta.state = 1;
	}

	return { success: true };
});

session_post_route('/api/trade/accept', async (req, url, client_id, json) => {
	const trade_id = json.trade_id;
	if (typeof trade_id !== 'number')
		return 400; // Bad Request

	const trade = await get_trade_offer(trade_id);
	if (!trade || trade.state !== 1 || trade.sender_id !== client_id)
		return 400; // Bad Request

	await db_execute('DELETE FROM `trade_items` WHERE `trade_id` = ? AND `counter` = 1', [trade_id]);
	await db_execute('DELETE FROM `trade_offers` WHERE `trade_id` = ?', [trade_id]);
	trade_cache.delete(trade_id);

	remove_player_cache_entry(trade_player_cache, trade.sender_id, trade_id);
	remove_player_cache_entry(trade_player_cache, trade.recipient_id, trade_id);

	await create_resolved_trade(trade_id, trade.recipient_id, trade.sender_id, false);

	return { success: true };
});

session_post_route('/api/trade/cancel', async (req, url, client_id, json) => {
	const trade_id = json.trade_id;
	if (typeof trade_id !== 'number')
		return 400; // Bad Request

	const trade = await get_trade_offer(trade_id);
	if (!trade)
		return 400; // Bad Request

	if (trade.state === 0 && trade.sender_id !== client_id)
		return 400; // Bad Request

	if (trade.state === 1 && trade.recipient_id !== client_id)
		return 400; // Bad Request

	await db_execute('DELETE FROM `trade_items` WHERE `trade_id` = ? AND `counter` = ?', [trade_id, trade.state]);

	if (trade.state === 1) {
		await db_execute('DELETE FROM `trade_items` WHERE `trade_id` = ? AND `counter` = 1', [trade_id]);
		await create_resolved_trade(trade_id, trade.sender_id, trade.recipient_id, true);
	}

	await db_execute('DELETE FROM `trade_offers` WHERE `trade_id` = ?', [trade_id]);

	trade_cache.delete(trade_id);

	remove_player_cache_entry(trade_player_cache, trade.sender_id, trade_id);
	remove_player_cache_entry(trade_player_cache, trade.recipient_id, trade_id);

	return { success: true };
});

session_post_route('/api/trade/decline', async (req, url, client_id, json) => {
	const trade_id = json.trade_id;
	if (typeof trade_id !== 'number')
		return 400; // Bad Request

	const trade = await get_trade_offer(trade_id);
	if (!trade || trade.recipient_id !== client_id)
		return 400; // Bad Request

	await db_execute('DELETE FROM `trade_offers` WHERE `trade_id` = ?', [trade_id]);
	trade_cache.delete(trade_id);

	remove_player_cache_entry(trade_player_cache, trade.recipient_id, trade_id);
	remove_player_cache_entry(trade_player_cache, trade.sender_id, trade_id);

	// return items to original sender
	await create_resolved_trade(trade_id, trade.sender_id, trade.recipient_id, true);

	return { success: true };
});

session_post_route('/api/trade/offer', async (req, url, client_id, json) => {
	const recipient_id = json.recipient_id;
	if (typeof recipient_id !== 'number')
		return 400; // Bad Request

	const items = json.items as TransferItem[];
	if (!validate_item_array(items))
		return 400; // Bad Request

	if (!(await friendship_exists(client_id, recipient_id)))
		return { error_lang: 'MOD_KMM_FRIENDSHIP_MISSING' };

	if (await trade_exists(client_id, recipient_id))
		return { error_lang: 'MOD_KMM_TRADE_EXISTS' };

	const trade_id = await db_insert(
		'INSERT INTO `trade_offers` (sender_id, recipient_id, attending_id) VALUES(?, ?, ?)',
		[client_id, recipient_id, recipient_id]
	);

	for (const item of items) {
		await db_execute(
			'INSERT INTO `trade_items` (trade_id, item_id, qty, counter) VALUES(?, ?, ?, 0)',
			[trade_id, item.id, item.qty]
		);
	}

	const trade_entry: ActiveTrade = { trade_id, state: 0, attending_id: recipient_id };
	trade_cache.set(trade_id, trade_entry);

	trade_player_cache.get(client_id)?.push(trade_id);
	trade_player_cache.get(recipient_id)?.push(trade_id);
	
	return { success: true, trade_id } as JsonSerializable;
});
// #endregion

// #region ROUTES GIFTING
session_post_route('/api/gift/accept', async (req, url, client_id, json) => {
	const gift_id = json.gift_id;
	if (typeof gift_id !== 'number')
		return 400; // Bad Request

	const gift = await get_gift(gift_id);
	if (gift?.client_id !== client_id)
		return 400; // Bad Request

	await delete_gift(gift);

	return { success: true };
});

session_post_route('/api/gift/decline', async (req, url, client_id, json) => {
	const gift_id = json.gift_id;
	if (typeof gift_id !== 'number')
		return 400; // Bad Request

	const gift = await get_gift(gift_id);
	if (gift?.client_id !== client_id)
		return 400; // Bad Request

	// client shouldn't allow this, so no need for bespoke error
	if ((gift.flags & GiftFlags.Returned) === GiftFlags.Returned)
		return 400; // Bad Request

	await return_gift(gift);

	return { success: true };
});

session_post_route('/api/gift/send', async (req, url, client_id, json) => {
	// validate that client_id and friend_id are actually friends
	// validate that the transfer item inventory contains equal or less than MAX_TRANSFER_ITEM_COUNT

	const friend_id = json.friend_id;
	if (typeof friend_id !== 'number')
		return 400; // Bad Request

	const items = json.items as TransferItem[];
	if (!validate_item_array(items))
		return 400; // Bad Request

	if (!(await friendship_exists(client_id, friend_id)))
		return { error_lang: 'MOD_KMM_FRIENDSHIP_MISSING' };

	if (items.length >= MAX_TRANSFER_ITEM_COUNT)
		return { error_lang: 'MOD_KMM_TOO_MANY_ITEMS' };

	if (await has_pending_gift(client_id, friend_id))
		return { error_lang: 'MOD_KMM_PENDING_GIFT' };

	await send_gift(client_id, friend_id, items);


	return { success: true } as JsonSerializable;
});
// #endregion

// #region ROUTES FRIENDS
session_post_route('/api/friends/remove', async (req, url, client_id, json) => {
	const friend_id = json.friend_id;
	if (typeof friend_id !== 'number')
		return 400; // Bad Request

	await delete_friend(client_id, friend_id);

	return { success: true };
});

session_get_route('/api/friends/get', async (req, url, client_id, json) => {
	return {
		friends: await get_friends(client_id)
	}
});

session_post_route('/api/friends/accept', async (req, url, client_id, json) => {
	const request_id = json.request_id;
	if (typeof request_id !== 'number')
		return 400; // Bad Request;

	const request = await get_friend_request(request_id);
	if (request !== null && request.client_id === client_id) {
		await create_friendship(request.client_id, request.friend_id);
		await delete_friend_request(request);

		return {
			success: true,
			friend: {
				friend_id: request.friend_id,
				display_name: await get_client_display_name(request.friend_id)
			}
		};
	}

	return { success: false } as JsonSerializable;
});

session_post_route('/api/friends/ignore', async (req, url, client_id, json) => {
	const request_id = json.request_id;
	if (typeof request_id !== 'number')
		return 400; // Bad Request

	const request = await get_friend_request(request_id);
	if (request !== null && request.client_id === client_id)
		await delete_friend_request(request);
	
	return { success: true };
});

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

	if (await friendship_exists(client_id, friend_user_id))
		return { error_lang: 'MOD_KMM_FRIENDSHIP_EXISTS' };

	// note: client_id and friend_id are swapped when inserting, as it makes logical sense to look up
	// client_id for requests, then add the friend_id, rather than looking up friend_id.
	if (!(await friend_request_exists(friend_user_id, client_id)))
		await create_friend_request(friend_user_id, client_id);

	return { success: true } as JsonSerializable;
});
// #endregion

// #region ROUTES GENERAL
session_get_route('/api/events', async (req, url, client_id) => {
	const trade_ids = await get_client_trades(client_id);
	const trade_meta = [];

	for (const trade_id of trade_ids) {
		const meta = await get_trade_offer_meta(trade_id);
		if (!meta)
			continue;

		trade_meta.push({
			trade_id,
			attending: meta.attending_id === client_id,
			state: meta.state
		});
	}

	return {
		friend_requests: await get_friend_requests(client_id),
		gifts: await get_client_gifts(client_id),
		trades: trade_meta,
		resolved_trades: await get_client_resolved_trades(client_id),
		campaign: get_campaign_progress()
	};
});

session_post_route('/api/client/set_icon', async (req, url, client_id, json) => {
	const icon_id = json.icon_id;
	if (typeof icon_id !== 'string')
		return 400; // Bad Request

	if (!icon_id.startsWith('melvorF:') && !icon_id.startsWith('melvorD:'))
		return 400; // Bad Request

	await db_execute('UPDATE `clients` SET `icon_id` = ? WHERE `id` = ?', [icon_id, client_id]);

	return { success: true };
});
// #endregion

// #region ROUTES AUTH
server.route('/api/authenticate', validate_req_json(async (req, url, json) => {
	await Bun.sleep(1000);

	const client_identifier = json.client_identifier;
	const client_key = json.client_key;

	if (typeof client_identifier !== 'string' || typeof client_key !== 'string')
		return 400; // Bad Request

	if (!is_valid_uuid(client_identifier) || !is_valid_uuid(client_key))
		return 400; // Bad Request

	const client_row = await db_get_single('SELECT `id`, `client_key`, `icon_id` FROM `clients` WHERE `client_identifier` = ? LIMIT 1', [client_identifier]) as db_row.clients;
	if (client_row === null || client_row.client_key !== client_key)
		return 401; // Unauthorized

	const display_name = validate_display_name(json.display_name);
	await db_execute('UPDATE `clients` SET `display_name` = ? WHERE `id` = ?', [display_name, client_row.id]);

	const session_token = await generate_session_token(client_row.id);
	log('client', 'authorized client session for {%s}', client_identifier);

	return { session_token, friend_code: client_row.friend_code, icon_id: client_row.icon_id };
}), 'POST');

server.route('/api/register', validate_req_json(async (req, url, json) => {
	await Bun.sleep(1000);

	const client_key = json.client_key;

	if (typeof client_key !== 'string' || !is_valid_uuid(client_key))
		return 400; // Bad Request

	const friend_code = await generate_friend_code();
	const display_name = validate_display_name(json.display_name);

	const client_identifier = crypto.randomUUID();
	const client_id = await db_insert('INSERT INTO `clients` (`client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) VALUES(?, ?, ?, ?, ?)', [client_identifier, client_key, friend_code, display_name, DEFAULT_USER_ICON_ID]);

	if (client_id === -1)
		return 500;

	log('client', 'registered new client {%d} [{%s}]', client_id, client_identifier);

	const session_token = await generate_session_token(client_id);
	return { session_token, client_identifier, friend_code, icon_id: DEFAULT_USER_ICON_ID };
}), 'POST');
// #endregion

// #region SERVER CONTROL
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
			await server.stop(true);
			process.exit(0);
		});
		return 200;
	});
} else {
	caution('GH_WEBHOOK_SECRET environment variable not configured');
}
// #endregion