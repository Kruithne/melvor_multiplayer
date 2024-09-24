export type db_row_clients = {
	id: number,
	client_identifier: string,
	client_key: string,
	friend_code: string,
	display_name: string,
	icon_id: string,
	last_charity: number,
	last_bonus_charity: number
} | null;