export type campaign_state = {
	id: number;
	campaign_id: string;
	item_id: string;
	item_amount: number;
	item_current: number;
	campaign_next: number;
	complete: number;
} | null;

export type charity_items = {
	item_id: string;
	qty: number;
} | null;

export type client_sessions = {
	session_token: string,
	client_id: number
} | null;

export type clients = {
	id: number,
	client_identifier: string,
	client_key: string,
	friend_code: string,
	display_name: string,
	icon_id: string,
	last_charity: number,
	last_bonus_charity: number
} | null;

export type friend_requests = {
	request_id: number,
	client_id: number,                   
	friend_id: number
} | null;

export type friends = {
	client_id_a: number;
	client_id_b: number;
} | null;

export type gift_items = {
	id: number;
	gift_id: number;
	item_id: string;
	qty: number;
} | null;

export type gifts = {
	gift_id: number;
	client_id: number;
	sender_id: number;
	flags: number;
} | null;

export type resolved_trade_offers = {
	trade_id: number;
	client_id: number;
	sender_id: number;
	declined: number;
} | null;

export type trade_items = {
	id: number;
	trade_id: number;
	item_id: string;
	qty: number;
	counter: number;
} | null;

export type trade_offers = {
	trade_id: number;
	sender_id: number;
	recipient_id: number;
	attending_id: number;
	state: number;
} | null;

export type campaign_contributions = {
	campaign_id: number;
	client_id: number;
	item_amount: number;
	taken: number;
} | null;

export type market_items = {
	id: number;
	item_id: string;
	qty: number;
	sold: number;
	price: number;
} | null;