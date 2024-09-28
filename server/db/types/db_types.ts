export type campaign_state = {
	id: number;
	campaign_id: string;
	item_id: string;
	item_amount: number;
	item_current: number;
	campaign_next: number;
	complete: number;
};

export type charity_items = {
	item_id: string;
	qty: number;
};

export type client_sessions = {
	session_token: string,
	client_id: number
};

export type clients = {
	id: number,
	client_identifier: string,
	client_key: string,
	friend_code: string,
	display_name: string,
	icon_id: string,
	last_charity: number,
	last_bonus_charity: number
};

export type friend_requests = {
	request_id: number,
	client_id: number,                   
	friend_id: number
};

export type friends = {
	client_id_a: number;
	client_id_b: number;
};

export type gift_items = {
	id: number;
	gift_id: number;
	item_id: string;
	qty: number;
};

export type gifts = {
	gift_id: number;
	client_id: number;
	sender_id: number;
	flags: number;
};

export type resolved_trade_offers = {
	trade_id: number;
	client_id: number;
	sender_id: number;
	declined: number;
};

export type trade_items = {
	id: number;
	trade_id: number;
	item_id: string;
	qty: number;
	counter: number;
};

export type trade_offers = {
	trade_id: number;
	sender_id: number;
	recipient_id: number;
	attending_id: number;
	state: number;
};

export type campaign_contributions = {
	campaign_id: number;
	client_id: number;
	item_amount: number;
	taken: number;
};

export type market_items = {
	id: number;
	client_id: number;
	item_id: string;
	qty: number;
	sold: number;
	price: number;
};