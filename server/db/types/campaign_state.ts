export type db_row_campaign_state = {
	id: number;
	campaign_id: string;
	item_id: string;
	item_amount: number;
	item_current: number;
	campaign_next: number;
	complete: number;
} | null;