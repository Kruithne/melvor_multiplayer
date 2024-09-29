// #region CONSTANTS
const SERVER_HOST = 'https://melvormultiplayer.net';
const LOG_PREFIX = '[multiplayer] ';

const IS_DEV_MODE = false;
const DEV_CHARACTER_STORAGE = {
	client_identifier: '04fcad4c-7df5-43c3-a70e-299cd618a0ab',
	client_key: 'f88596d3-e2b2-4a50-9754-6b05f1a15bac',
	friend_code: '689-388-847',
	transfer_inventory: [
		{
			id: 'melvorF:Fire_Acolyte_Wizard_Hat', // hats, get your hats! free hats!
			qty: 200
		}
	]
};

const TRANSFER_INVENTORY_MAX_LIMIT = 32;
const GIFT_FLAG_RETURNED = 1 << 0;

const CHARITY_TIMEOUT = 1000 * 60 * 60 * 24; // 24 hours
const CHARITY_CHECK_TIMEOUT = 10 * 1000; // 10 seconds

const CAMPAIGN_MAX_SOLO_CONTRIB_FAC = 0.25;

const MARKET_ITEMS_PER_PAGE = 30;
// #endregion

// #region GLOBALS
const ctx = mod.getContext(import.meta);

let session_token = null;
let is_connecting = false;

let last_charity_check = 0;

let has_sorted_market_filter_items = false;
let has_done_first_market_search = false;

const skill_pets = new Map();
// #endregion

const state = ui.createStore({
	// #region REACTIVE GLOBALS
	TRANSFER_INVENTORY_MAX_LIMIT,

	is_connected: false,
	is_transfer_page_visible: false,
	is_updating_transfer_contents: false,

	removing_friend: null,
	gifting_friend: null,

	friend_code: '',
	icon_search: '',
	picked_icon: '',
	profile_icon: 'melvorF:Fire_Acolyte_Wizard_Hat',

	add_gp_value: 0,
	item_slider_value: 0,

	transfer_inventory: [],
	selected_transfer_item_id: '',

	charity_tree_inventory: [],
	selected_charity_item_id: '',
	charity_timeout: 0,
	charity_bonus_timeout: 0,
	charity_bonus_unlocked: false,
	charity_update_time: Date.now(),
	charity_tree_loading: false,

	campaign_data: {},
	campaign_active: false,
	campaign_id: '',
	campaign_next_timestamp: 0,
	campaign_item_id: '',
	campaign_pct: 0,
	campaign_item_total: 0,
	campaign_contribution: 0,
	campaign_loading: false,
	campaign_has_data: false,
	campaign_history: [],
	campaign_rankings: {},
	campaign_update_time: Date.now(),

	market_active_tab: 'search',
	market_results: [],
	market_listings: [],
	market_buy_item: null,
	market_filter_item: null,
	market_filter_search: '',
	market_filter_items: [],
	market_search_loading: false,
	market_listings_loading: false,
	market_sort_direction: 1,
	market_completed: [],

	market_total_items: 0,
	market_current_page: 1,

	events: {
		friend_requests: []
	},

	trades: [],
	gifts: [],
	resolved_trades: [],

	available_icons: [],

	friends: [],
	// #endregion

	// #region COMPUTED PROPS
	get sorted_trades() {
		return this.trades.sort((a, b) => a.attending === b.attending ? 0 : a.attending ? -1 : 1);
	},

	get transfer_inventory_value_raw() {
		let total_value = 0;

		for (const entry of this.transfer_inventory) {
			if (entry.id === 'melvorD:GP') {
				total_value += entry.qty;
		 	} else {
				const item = game.items.getObjectByID(entry.id);
				if (item?.sellsFor.currency === game.gp)
					total_value += game.bank.getItemSalePrice(item, entry.qty);
			}
		}

		return total_value;
	},

	get transfer_inventory_value() {
		return game.gp.formatAmount(numberWithCommas(this.transfer_inventory_value_raw));
	},

	get add_gp_value_formatted() {
		return formatNumber(this.add_gp_value);
	},

	get filtered_icons() {
		const icon_search_lower = this.icon_search.toLowerCase();
		return this.available_icons.filter(icon => icon.search_name.includes(icon_search_lower)).slice(0, 32);
	},

	get num_notifications() {
		return this.num_friend_requests + this.num_transfer_offers + this.num_market_sold_items;
	},

	get num_market_sold_items() {
		return this.market_completed.length;
	},

	get num_attending_trades() {
		return this.trades.filter(trade => trade.attending).length;
	},

	get num_transfer_offers() {
		return this.gifts.length + this.num_attending_trades + this.resolved_trades.length;
	},

	get num_friend_requests() {
		return this.events.friend_requests.length;
	},

	get num_active_transfers() {
		return this.gifts.length + this.resolved_trades.length + this.trades.length;
	},

	get is_charity_ready() {
		return state.charity_timeout + CHARITY_TIMEOUT < state.charity_update_time;
	},

	get is_charity_bonus_ready() {
		return state.charity_bonus_timeout + CHARITY_TIMEOUT < state.charity_update_time;
	},

	get can_take_charity() {
		return this.is_charity_ready || (this.charity_bonus_unlocked && this.is_charity_bonus_ready);
	},

	get campaign_item_current() {
		return Math.round(this.campaign_item_total * this.campaign_pct);
	},

	get campaign_item_name() {
		const item = game.items.getObjectByID(state.campaign_item_id);
		return item?.name ?? 'Unknown Item';
	},

	get campaign_item_icon() {
		return this.get_item_icon(state.campaign_item_id);
	},

	get campaign_max_solo_contrib() {
		return this.campaign_item_total * CAMPAIGN_MAX_SOLO_CONTRIB_FAC;
	},

	get campaign_max_solo_contrib_reached() {
		return this.campaign_contribution >= this.campaign_max_solo_contrib;
	},

	get campaign_next_formatted() {
		const delta = this.campaign_next_timestamp - this.campaign_update_time;
		const seconds = Math.floor(delta / 1000);
		
		if (seconds < 60)
			return 'less than a minute';
		
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		
		if (hours > 0)
			return `${hours} ${hours !== 1 ? 'hours' : 'hour'}`;
		
		return `${minutes} ${minutes !== 1 ? 'minutes' : 'minute'}`;
	},

	get market_buy_price_formatted() {
		if (this.market_buy_item)
			return formatNumber(this.market_buy_item.price * this.item_slider_value) + ' GP';

		return '0 GP';
	},

	get market_filter_search_sanitized() {
		return this.market_filter_search.trim().toLowerCase();
	},

	get market_filter_items_filtered() {
		if (this.market_filter_search_sanitized.length === 0)
			return this.market_filter_items;

		return this.market_filter_items.filter(item => item.name_lower.includes(this.market_filter_search_sanitized));
	},

	get market_page_count() {
		return Math.ceil(this.market_total_items / MARKET_ITEMS_PER_PAGE);
	},
	// #endregion

	// #region COMMON ACTIONS
	get_svg(id) {
		return ctx.getResourceUrl('assets/' + id + '.svg');
	},

	get_svg_url(id) {
		return 'url(' + this.get_svg(id) + ')';
	},

	get_item_icon(id) {
		if (id === 'melvorD:GP')
			return game.gp.media;

		const item = game.items.getObjectByID(id);
		return item?.media ?? 'assets/media/main/question.png';
	},

	get_item_name(id) {
		const item = game.items.getObjectByID(id);
		return item?.name ?? 'Unknown Item';
	},

	get_pet_icon(id) {
		const pet = game.pets.getObjectByID(id);
		return pet?.media ?? 'assets/media/main/question.png';
	},

	close_modal() {
		Swal.close();
	},

	toggle_online_dropdown() {
		const class_list = state.$dropdown_menu.classList;
		class_list.toggle('show');
	},

	hide_online_dropdown() {
		state.$dropdown_menu.classList.remove('show');
	},

	reconnect() {
		state.hide_online_dropdown();
		start_multiplayer_session();
	},
	// #endregion

	// #region MARKET ACTIONS
	clear_market_filter() {
		this.market_filter_item = null;
		state.market_page_first(true);
	},

	choose_market_filter() {
		this.market_active_tab = 'filter';
		this.market_filter_search = '';

		if (!has_sorted_market_filter_items)
			load_market_filter_items();

		setTimeout(() => $('kmm-market-filter-input').focus(), 1);
	},

	select_market_filter_item(item_id) {
		state.market_filter_item = item_id;
		state.market_active_tab = 'search';
		state.market_page_first(true);
	},

	show_market_buy_modal(item) {
		this.market_buy_item = item;

		const item_name = this.get_item_name(item.item_id);
		queue_modal(getLangString('MOD_KMM_MARKET_BUY_MODAL_TITLE') + item_name, 'market-buy-modal', this.get_item_icon(item.item_id), {
			showConfirmButton: false
		}, false, false);
	},

	async buy_market_item(event) {
		const $button = event.currentTarget;

		if (is_button_spinning($button))
			return;

		if (!state.market_buy_item)
			return notify_error('MOD_KMM_GENERIC_ERR');

		if (state.item_slider_value <= 0)
			return notify_error('MOD_KMM_MARKET_BUY_NOTHING');

		const item = game.items.getObjectByID(state.market_buy_item.item_id);
		if (!item)
			return notify_error('MOD_KMM_MARKET_BUY_ERROR_UNKNOWN');

		show_button_spinner($button);

		const res = await api_post('/api/market/buy', {
			id: state.market_buy_item.id,
			qty: state.item_slider_value
		});

		if (res?.success) {
			add_bank_item(res.item_id, res.item_qty);
			game.gp.remove(res.gp_loss);

			state.market_buy_item.available = res.new_item_qty;
		} else {
			notify_error(res?.error_lang ?? 'MOD_KMM_MARKET_BUY_ERROR');
		}

		hide_button_spinner($button);
		this.close_modal();
	},

	market_page(page) {
		const before = this.market_current_page;
		this.market_current_page = page;

		if (this.market_current_page !== before)
			update_market_search();
	},

	market_page_first(force_reload = false) {
		const before = this.market_current_page;
		this.market_current_page = 1;

		if (force_reload || this.market_current_page !== before)
			update_market_search();
	},

	market_page_prev() {
		const before = this.market_current_page;
		this.market_current_page = Math.max(this.market_current_page - 1, 1);

		if (this.market_current_page !== before)
			update_market_search();
	},

	market_page_next() {
		const before = this.market_current_page;
		this.market_current_page = Math.min(this.market_current_page + 1, this.market_page_count);

		if (this.market_current_page !== before)
			update_market_search();
	},

	market_page_last() {
		const before = this.market_current_page;
		this.market_current_page = this.market_page_count;

		if (this.market_current_page !== before)
			update_market_search();
	},

	toggle_market_sort() {
		state.market_sort_direction = state.market_sort_direction ^ 1;
		update_market_search();
	},

	open_market_tab() {
		this.market_active_tab = 'search';
	},

	open_listing_tab() {
		this.market_active_tab = 'listing';
		update_market_listings();
	},

	async resolve_market_listing(event, item, cancel) {
		const $button = event.currentTarget;

		if ($button.classList.contains('disabled') || is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/market/' + (cancel ? 'cancel' : 'payout'), { id: item.id });
		if (res?.success) {
			if (res.payout > 0) {
				game.gp.add(res.payout);
				item.payout += res.payout;
			}

			if (cancel || res.ended) {
				state.market_listings = state.market_listings.filter(listing => listing.id !== item.id);
				state.market_completed = state.market_completed.filter(listing => listing !== item.id);
			}
		} else {
			notify_error('MOD_KMM_GENERIC_ERR');
		}

		hide_button_spinner($button);
	},
	// #endregion

	// #region CAMPAIGN ACTIONS
	get_campaign_svg(id) {
		return this.get_svg(this.campaign_data[id]?.asset ?? 'campaign_placeholder')
	},

	get_current_campaign_svg() {
		return this.get_campaign_svg(this.campaign_id)
	},

	get_campaign_title(id) {
		return getLangString(this.campaign_data[id]?.name_lang ?? 'MOD_KMM_CAMPAIGN_NAME_UNKNOWN');
	},

	get_current_campaign_title() {
		return this.get_campaign_title(this.campaign_id);
	},

	get_campaign_color(id) {
		return this.campaign_data[id]?.color_code ?? '#acacac';
	},

	get_current_campaign_color() {
		return this.get_campaign_color(this.campaign_id);
	},

	show_campaign_contribute_modal() {
		queue_modal('MOD_KMM_CAMPAIGN_CONTRIBUTE', 'campaign-contribute-modal', this.campaign_item_icon, {
			showConfirmButton: false
		}, true, false);
	},

	async contribute_to_campaign(event) {
		if (!state.campaign_active || !state.campaign_has_data)
			return notify_error('MOD_KMM_CAMPAIGN_CONTRIBUTE_ERR');

		const item_amount = state.item_slider_value;
		if (item_amount <= 0)
			return;

		const item = game.items.getObjectByID(state.campaign_item_id);
		const item_owned_qty = game.bank.getQty(item);

		if (item_owned_qty < item_amount)
			return notify_error('MOD_KMM_CAMPAIGN_CONTRIBUTE_AMOUNT_ERR');

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/campaign/contribute', { item_amount });
		if (res?.success && res?.item_loss > 0) {
			const remove_item = game.items.getObjectByID(res.item_id);
			game.bank.removeItemQuantity(remove_item, res.item_loss);
			state.campaign_contribution += res.item_loss;
			state.campaign_pct = res.campaign_pct;

			update_campaign_nav();
			notify_item('MOD_KMM_CAMPAIGN_CONTRIBUTED', 'success', remove_item, res.item_loss);
		} else {
			notify_error('MOD_KMM_CAMPAIGN_CONTRIBUTE_ERR');
		}

		hide_button_spinner($button);
		this.close_modal();
	},

	async claim_campaign_reward(event, campaign) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		let reward_mod = 1.6;

		const campaign_pet = game.pets.getObjectByID(campaign.pet);
		if (game.petManager.unlocked.has(campaign_pet))
			reward_mod += 0.1;

		const reward_item = game.items.getObjectByID(campaign.item_id);
		const reward_value = (reward_item.sellsFor.quantity * campaign.item_amount) * reward_mod;

		const res = await api_post('/api/campaign/claim', { campaign_id: campaign.id, value: reward_value });
		if (res?.success) {
			game.gp.add(reward_value);
			campaign.taken = reward_value;
		} else {
			notify_error('MOD_KMM_GENERIC_ERR');
		}

		hide_button_spinner($button);
	},

	get_campaign_ranking(campaign_id) {
		return this.campaign_rankings[campaign_id] ?? 0;
	},
	// #endregion

	// #region CHARITY ACTIONS
	async charity_take_item(event) {
		const item = this.charity_tree_inventory.find(e => e.id === state.selected_charity_item_id);
		if (!item)
			return notify_error('MOD_KMM_CHARITY_INVALID_ITEM');

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/charity/take', {
			item_id: state.selected_charity_item_id
		});

		if (res?.success) {
			add_bank_item(item.id, res.item_qty);
			state.charity_tree_inventory = state.charity_tree_inventory.filter(e => e.id !== item.id);
		} else {
			notify_error(res?.error_lang ?? 'MOD_KMM_CHARITY_TAKEN');
		}

		if (res?.timeout !== undefined) {
			state.charity_timeout = res.timeout;
			set_character_storage_item('charity_timeout', res.timeout);
		}

		if (res?.timeout_bonus !== undefined) {
			state.charity_bonus_timeout = res.timeout_bonus;
			set_character_storage_item('charity_bonus_timeout', res.timeout_bonus);
		}

		hide_button_spinner($button);
	},

	async donate_items(event) {
		const items = state.transfer_inventory;

		if (items.length === 0)
			return notify_error('MOD_KMM_CHARITY_NO_SELECTION');

		for (const item_entry of items) {
			const item = game.items.getObjectByID(item_entry.id);
			if (item.isModded)
				return notify_error('MOD_KMM_CHARITY_MODDED_ITEM');
		}

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/charity/donate', { items });
		if (res?.success) {
			const donation_value = state.transfer_inventory_value_raw;

			state.transfer_inventory = [];
			last_charity_check = 0;

			notify('MOD_KMM_CHARITY_DONATED');

			// 0.1% + for every 10,000,000 worth of donation, % to get pet is +1%, capped at 10%
			const pet_pct = Math.min(0.1 + Math.floor(donation_value / 10000000) / 100, 0.1);
			if (Math.random() < pet_pct) {
				state.charity_bonus_unlocked = true;
				game.petManager.unlockPetByID('kru_melvor_multiplayer:Multiplayer_Pet_Charity');
			}
		}

		hide_button_spinner($button);
	},
	// #endregion

	// #region TRADE ACTIONS
	create_trade() {
		if (state.transfer_inventory.length > 0) {
			queue_modal('MOD_KMM_TITLE_SEND_TRADE_OFFER', 'create-trade-modal', 'assets/transfer_bag.svg', {
				showConfirmButton: false
			}, true);
		} else {
			notify_error('MOD_KMM_TRANSFER_NO_ITEMS_ERR');
		}
	},

	async select_trade_recipient(friend) {
		this.close_modal();

		const res = await api_post('/api/trade/offer', {
			recipient_id: friend.friend_id,
			items: state.transfer_inventory
		});

		if (res?.success) {
			state.transfer_inventory = [];

			state.trades.push({
				trade_id: res.trade_id,
				state: 0,
				data: null
			});

			update_transfer_contents();
		}
	},

	get_trade_items_value(items) {
		let total_value = 0;

		for (const entry of items) {
			if (entry.item_id === 'melvorD:GP') {
				total_value += entry.qty;
			} else {
				const item = game.items.getObjectByID(entry.item_id);
				if (item?.sellsFor.currency === game.gp)
					total_value += game.bank.getItemSalePrice(item, entry.qty);
			}
		}

		return game.gp.formatAmount(numberWithCommas(total_value));
	},

	filter_trade_items_home(trade) {
		return trade.data.items.filter(item => item.counter === (trade.attending ? 0 : 1));
	},

	filter_trade_items_away(trade) {
		return trade.data.items.filter(item => item.counter === (trade.attending ? 1 : 0));
	},

	async counter_trade(event, trade_id) {
		const trade = state.trades.find(t => t.trade_id === trade_id);
		if (!trade)
			return;

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/trade/counter', {
			trade_id,
			items: state.transfer_inventory
		});

		hide_button_spinner($button);

		if (res?.success) {
			state.transfer_inventory = [];

			state.trades = state.trades.filter(t => t.trade_id !== trade_id);

			// this needs to happen on the next tick to prevent petite-vue breaking
			// bug: https://github.com/vuejs/core/issues/5657 (element hoisting is not a good solution)
			setTimeout(() => {
				state.trades.push({
					trade_id,
					state: 1,
					attending: false,
					data: null
				});

				update_transfer_contents();
			}, 1);

		} else {
			notify_error('MOD_KMM_GENERIC_ERR');
		}
	},

	async resolve_trade(event, trade_id) {
		// prevent resolving a trade with no local data
		const trade = state.resolved_trades.find(t => t.trade_id === trade_id);
		if (!trade?.data)
			return;

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/trade/resolve', { trade_id });

		hide_button_spinner($button);

		if (res?.success === true) {
			for (const item of trade.data.items)
				add_bank_item(item.item_id, item.qty);

			state.resolved_trades = state.resolved_trades.filter(trade => trade.trade_id !== trade_id);
		} else {
			notify_error('MOD_KMM_GENERIC_ERR');
		}
	},

	async decline_trade(event, trade_id) {
		// prevent declining a trade with no local data
		const trade = state.trades.find(t => t.trade_id === trade_id);
		if (!trade?.data)
			return;

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/trade/decline', { trade_id });
		hide_button_spinner($button);

		if (res?.success === true) {
			state.trades = state.trades.filter(trade => trade.trade_id !== trade_id);
		} else {
			notify_error('MOD_KMM_GENERIC_ERR');
		}
	},

	async accept_trade(event, trade_id) {
		// prevent accepting a trade with no local data
		const trade = state.trades.find(t => t.trade_id === trade_id);
		if (!trade?.data)
			return;

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/trade/accept', { trade_id });
		hide_button_spinner($button);

		if (res?.success === true) {
			const items = trade.data.items.filter(item => item.counter === 1);
			for (const item of items)
				add_bank_item(item.item_id, item.qty);

			state.trades = state.trades.filter(trade => trade.trade_id !== trade_id);
		} else {
			notify_error('MOD_KMM_GENERIC_ERR');
		}
	},

	async cancel_trade(event, trade_id) {
		// prevent cancelling a trade with no local data
		const trade = state.trades.find(t => t.trade_id === trade_id);
		if (!trade?.data)
			return;

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/trade/cancel', { trade_id });
		hide_button_spinner($button);

		if (res?.success === true) {
			let items = trade.data.items;

			if (trade.state === 1)
				items = items.filter(item => item.counter === 1);

			for (const item of items)
				add_bank_item(item.item_id, item.qty);
			
			state.trades = state.trades.filter(trade => trade.trade_id !== trade_id);
		} else {
			notify_error('MOD_KMM_GENERIC_ERR');
		}
	},
	// #endregion

	// #region GIFT ACTIONS
	is_returned_gift(gift) {
		return (gift.data.flags & GIFT_FLAG_RETURNED) !== 0;
	},

	async resolve_gift(event, gift_id, accept) {
		const $button = event.currentTarget;

		if (is_button_spinning($button))
			return;

		const gift = this.gifts.find(g => g.id === gift_id);
		if (gift === undefined)
			return notify_error('MOD_KMM_GENERIC_ERR');

		show_button_spinner($button);

		const res = await api_post(accept ? '/api/gift/accept' : '/api/gift/decline', { gift_id });
		hide_button_spinner($button);

		if (res?.success) {
			if (accept) {
				for (const item of gift.data.items) {
					const check_item = game.items.getObjectByID(item.item_id);
					if (check_item)
						add_bank_item(item.item_id, item.qty);
				}
			}

			this.gifts = this.gifts.filter(g => g.id !== gift_id);
		} else {
			notify_error('MOD_KMM_GENERIC_ERR');
		}
	},

	gift_friend() {
		if (state.transfer_inventory.length > 0) {
			queue_modal('MOD_KMM_TITLE_SEND_GIFT', 'gift-friend-modal', 'assets/media/bank/present.png', {
				showConfirmButton: false
			}, true, false);
		} else {
			notify_error('MOD_KMM_TRANSFER_NO_ITEMS_ERR');
		}
	},

	select_gift_recipient(friend) {
		this.close_modal();

		state.gifting_friend = friend;

		queue_modal('MOD_KMM_TITLE_CONFIRM_GIFT_RECIPIENT', 'confirm-gift-recipient-modal', 'assets/media/bank/present.png', {
			showConfirmButton: false
		}, true, false);
	},

	async confirm_gift(event) {
		const $button = event.currentTarget;

		if (is_button_spinning($button))
			return;

		show_button_spinner($button);
		const friend_id = state.gifting_friend.friend_id;

		const res = await api_post('/api/gift/send', {
			friend_id,
			items: state.transfer_inventory
		});

		try {
			if (res === null)
				throw new Error('MOD_KMM_GENERIC_ERR');

			if (res.error_lang)
				throw new Error(res.error_lang);
		} catch (e) {
			hide_button_spinner($button);
			return show_modal_error(getLangString(e.message));
		}

		hide_button_spinner($button);

		state.transfer_inventory = [];

		notify('MOD_KMM_NOTIF_GIFT_SENT');
		state.close_modal();
	},
	// #endregion

	// #region TRANSFER ACTIONS
	get_transfer_value(transfer) {
		if (transfer.data === null)
			return '...';

		let total_value = 0;

		for (const entry of transfer.data.items) {
			if (entry.item_id === 'melvorD:GP') {
				total_value += entry.qty;
			} else {
				const item = game.items.getObjectByID(entry.item_id);
				if (item?.sellsFor.currency === game.gp)
					total_value += game.bank.getItemSalePrice(item, entry.qty);
			}
		}

		return game.gp.formatAmount(numberWithCommas(total_value));
	},

	open_transfer_data_page() {
		state.hide_online_dropdown();
		changePage(game.pages.getObjectByID('kru_melvor_multiplayer:Transfer_Items'));
	},

	open_market_page(tab_id) {
		state.hide_online_dropdown();
		changePage(game.pages.getObjectByID('kru_melvor_multiplayer:Multiplayer_Market'));
		state.market_active_tab = tab_id;
	},

	async add_gp_to_transfer() {
		add_gp_to_transfer(state.add_gp_value);
		this.close_modal();
	},

	show_add_gp_modal() {
		queue_modal('MOD_KMM_TITLE_ADD_GP', 'add-gp-modal', 'assets/media/main/coins.png', {
			showConfirmButton: false
		}, true, false);
	},

	transfer_return_selected() {
		return_selected_transfer_inventory();
	},

	transfer_return_all() {
		return_all_transfer_inventory();
	},
	// #endregion

	// #region ICON PICK ACTIONS
	pick_icon(icon) {
		this.picked_icon = icon.id;

		const $image = document.querySelector('.swal2-image');

		if ($image)
			$image.src = icon.media;
	},

	async confirm_icon_pick(event) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/client/set_icon', { icon_id: this.picked_icon });
		if (res?.success)
			this.profile_icon = this.picked_icon;

		hide_button_spinner($button);
		this.close_modal();
	},

	show_icon_modal() {
		this.hide_online_dropdown();
		setup_icons();

		state.picked_icon = '';

		queue_modal(game.characterName, 'change-icon-modal', game.items.getObjectByID(state.profile_icon).media, {
			showConfirmButton: false
		}, false, false);
	},
	// #endregion

	// #region FRIEND REQ ACTIONS
	async accept_friend_request(event, request) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/friends/accept', {
			request_id: request.request_id
		});

		hide_button_spinner($button);

		if (res?.success === true) {
			state.events.friend_requests.splice(state.events.friend_requests.indexOf(request), 1);

			if (res.friend)
				state.friends.push(res.friend);
		} else {
			notify_error('MOD_KMM_GENERIC_ERR');
		}
	},

	async ignore_friend_request(event, request) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/friends/ignore', {
			request_id: request.request_id
		});

		hide_button_spinner($button);

		if (res?.success === true) {
			state.events.friend_requests.splice(state.events.friend_requests.indexOf(request), 1);
		} else {
			notify_error('MOD_KMM_GENERIC_ERR');
		}
	},

	show_friend_request_modal() {
		state.hide_online_dropdown();
		queue_modal('MOD_KMM_TITLE_FRIEND_REQUESTS', 'friend-request-modal');
	},
	// #endregion

	// #region FRIEND LIST ACTIONS
	remove_friend_prompt(friend) {
		this.close_modal();

		state.removing_friend = friend;

		queue_modal('MOD_KMM_TITLE_REMOVE_FRIEND_CONFIRM', 'remove-friend-modal', 'assets/remove_friend.svg', {
			showConfirmButton: false
		});
	},

	async remove_friend($event) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);
		const friend_id = state.removing_friend.friend_id;

		const res = await api_post('/api/friends/remove', { friend_id });

		if (res?.success) {
			state.friends = state.friends.filter(f => f.friend_id !== friend_id);
			notify('MOD_KMM_NOTIF_FRIEND_REMOVED');
		}

		hide_button_spinner($button);
		state.close_modal();
	},

	show_friends_modal() {
		state.hide_online_dropdown();
		queue_modal('MOD_KMM_TITLE_FRIENDS', 'friends-modal');
	},
	// #endregion

	// #region FRIEND ACTIONS
	show_friend_code_modal() {
		state.hide_online_dropdown();
		state.friend_code = get_character_storage_item('friend_code');

		queue_modal('MOD_KMM_TITLE_FRIEND_CODE', 'friend-code-modal');
	},

	show_add_friend_modal() {
		state.hide_online_dropdown();

		queue_modal('MOD_KMM_TITLE_ADD_FRIEND', 'add-friend-modal', 'assets/add_user.svg', {
			showConfirmButton: false
		});
	},

	async add_friend(event) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		hide_modal_error();
		show_button_spinner($button);

		const friend_code = $('kmm-add-friend-modal-field').value.trim();

		try {
			if (!/^\d{3}-\d{3}-\d{3}$/.test(friend_code))
				throw new Error('MOD_KMM_INVALID_FRIEND_CODE_ERR');

			const client_friend_code = get_character_storage_item('friend_code');
			if (friend_code === client_friend_code)
				throw new Error('MOD_KMM_NO_SELF_LOVE_ERR');

			const res = await api_post('/api/friends/add', { friend_code });
			if (res === null)
				throw new Error('MOD_KMM_GENERIC_ERR');

			if (res.error_lang)
				throw new Error(res.error_lang);
		} catch (e) {
			hide_button_spinner($button);
			return show_modal_error(getLangString(e.message));
		}

		hide_button_spinner($button);

		notify('MOD_KMM_NOTIF_FRIEND_REQ_SENT');
		state.close_modal();
	},
	// #endregion
});

// #region COMMON FUNCTIONS
function queue_modal(title_lang, template_id, image_url = 'assets/multiplayer.svg', data = {}, localize_title = true, get_image = true) {
	addModalToQueue(Object.assign({
		title: localize_title ? getLangString(title_lang) : title_lang,
		html: modal_component(template_id),
		imageUrl: get_image ? ctx.getResourceUrl(image_url) : image_url,
		imageWidth: 64,
		imageHeight: 64,
		allowOutsideClick: true,
		backdrop: true
	}, data));
}

function show_modal_error(text) {
	const $modal_error = $('kmm-modal-error');
	$modal_error.textContent = text;
	$modal_error.classList.remove('d-none');
}

function hide_modal_error() {
	$('kmm-modal-error').classList.add('d-none');
}

function show_button_spinner(element) {
	if (typeof element === 'string')
		element = $(element);

	const $spinner = element.querySelector('[role="status"]');
	$spinner.classList.remove('d-none');
}

function hide_button_spinner(element) {
	if (typeof element === 'string')
		element = $(element);

	const $spinner = element.querySelector('[role="status"]');
	$spinner.classList.add('d-none');
}

function is_button_spinning(element) {
	if (typeof element === 'string')
		element = $(element);

	const $spinner = element.querySelector('[role="status"]');
	return !$spinner.classList.contains('d-none');
}

function modal_component(template_id) {
	return `<kmm-modal-component data-template-id="${template_id}"></kmm-modal-component>`;
}

function make_template(id, parent = null) {
	return ui.create({ $template: '#template-kru-multiplayer-' + id, state }, parent ?? document.body);
}

function $(id) {
	return document.getElementById(id);
}

function notify_error(lang_id, icon) {
	notify(lang_id, 'danger', icon);
}

function notify(lang_id, theme = undefined, icon = 'assets/multiplayer.svg', qty = 1) {
	notifyPlayer({ media: ctx.getResourceUrl(icon) }, getLangString(lang_id), theme, qty);
}

function notify_item(lang_id, theme = undefined, item, qty = 1) {
	notifyPlayer({ media: item.media }, getLangString(lang_id), theme, qty);
}

function log(message, ...params) {
	console.log(LOG_PREFIX + message, ...params);
}

function error(message, ...params) {
	console.error(LOG_PREFIX + message, ...params);
}

function add_bank_item(item_id, amount) {
	if (item_id === 'melvorD:GP')
		game.gp.add(amount);
	else
		game.bank.addItemByID(item_id, amount, false, false, true);
}

function get_character_storage_item(key) {
	if (IS_DEV_MODE)
		return DEV_CHARACTER_STORAGE[key];

	return ctx.characterStorage.getItem(key);
}

function set_character_storage_item(key, value) {
	if (IS_DEV_MODE)
		DEV_CHARACTER_STORAGE[key] = value;
	else
		ctx.characterStorage.setItem(key, value);
}

function on_page_toggle(id, callback, visible_only) {
	const $element = $(id);
	const observer = new MutationObserver(() => {
		const is_visible = !$element.classList.contains('d-none');

		if (!visible_only || is_visible)
			callback(is_visible);
	});

	observer.observe($element, {
		attributes: true,
		attributeFilter: ['class']
	});
}
// #endregion

// #region MARKET FUNCTIONS
async function update_market_page() {
	if (state.market_active_tab === 'search') {
		if (!has_done_first_market_search) {
			has_done_first_market_search = true;
			await update_market_search();
		}
	} else if (state.market_active_tab === 'listing') {
		await update_market_listings();
	}
}

async function market_create_listing(item, item_qty, item_sell_price) {
	if (item_qty <= 0)
		return notify_error('MOD_KMM_MARKET_CANNOT_SELL_NOTHING');

	if (item_sell_price <= 0)
		return notify_error('MOD_KMM_MARKET_CANNOT_SELL_FREE');

	if (game.bank.getQty(item) < item_qty)
		return notify_error('MOD_KMM_MARKET_NOT_ENOUGH_ITEM');

	if (item.isModded)
		return notify_error('MOD_KMM_MARKET_CANNOT_SELL_MODDED');

	const res = await api_post('/api/market/sell', {
		item_id: item.id,
		item_qty,
		item_sell_price
	});

	if (res?.success) {
		game.bank.removeItemQuantity(item, item_qty);
		notify('MOD_KMM_MARKET_ITEM_LISTED', 'success', 'assets/marker.svg', item_qty);

		if (state.market_active_tab === 'listing')
			update_market_listings();
	} else {
		notify_error(res?.error_lang ?? 'MOD_KMM_GENERIC_ERR');
	}
}

async function update_market_listings() {
	if (state.market_listings_loading)
		return;

	state.market_listings_loading = true;

	const res = await api_get('/api/market/listings');
	state.market_listings = res?.items ?? [];
	state.market_listings_loading = false;
}

async function update_market_search() {
	if (state.market_search_loading)
		return;

	state.market_search_loading = true;

	const data = {
		page: state.market_current_page,
		sort: state.market_sort_direction
	};

	if (state.market_filter_item !== null)
		data.item_id = state.market_filter_item;

	const res = await api_post('/api/market/search', data);
	if (res?.success) {
		state.market_total_items = res.total_items;
		state.market_results = res.items;
	} else {
		state.market_results = [];
		state.market_total_items = 0;
	}

	state.market_search_loading = false;
}

function load_market_filter_items() {
	state.market_filter_items = [...game.items.registeredObjects].map(e => e[1]).filter(item => {
		if (item.category === '')
			return false;

		if (item.isModded)
			return false;

		return true;
	}).map(item => {
		return {
			id: item.id,
			name: item.name,
			name_lower: item.name.toLowerCase(),
			media: item.media,
		}
	});

	has_sorted_market_filter_items = true;
}
// #endregion

// #region CAMPAIGN FUNCTIONS
async function update_campaign_info() {
	state.campaign_update_time = Date.now();

	if (state.campaign_loading || state.campaign_has_data)
		return;

	state.campaign_loading = true;

	const res = await api_get('/api/campaign/info');

	if (res !== null) {
		state.campaign_has_data = true;
		state.campaign_history = res.history;
		state.campaign_rankings = res.rankings;

		if (res.active) {
			state.campaign_id = res.campaign_id;
			state.campaign_item_id = res.item_id;
			state.campaign_item_total = res.item_total;
			state.campaign_contribution = res.contribution;
		} else {
			state.campaign_next_timestamp = res.next_campaign;
		}

		check_campaign_pets();
	} else {
		notify_error('MOD_KMM_GENERIC_ERR');
	}

	state.campaign_loading = false;
}

function check_campaign_pets() {
	for (const [campaign_id, ranking] of Object.entries(state.campaign_rankings)) {
		if (ranking < 4)
			continue;

		const campaign_data = state.campaign_data[campaign_id];
		const pet = game.pets.getObjectByID(campaign_data.pet);

		if (!game.petManager.unlocked.has(pet))
			game.petManager.unlockPetByID(campaign_data.pet);
	}
}

async function load_campaign_data(ctx) {
	state.campaign_data = await ctx.loadData('data/campaigns.json');
}

function update_campaign_nav() {
	const aside = document.querySelector('.kmm-campaign-nav');

	if (state.campaign_active)
		aside.textContent = Math.floor(state.campaign_pct * 100) + '%';
	else
		aside.textContent = 'Inactive';
}
// #endregion

// #region PET FUNCTIONS
async function load_pets(ctx) {
	const pets = await ctx.loadData('data/pets.json');
	
	ctx.gameData.buildPackage(pkg => {
		for (const pet of pets) {
			pet.name = getLangString(pet.name);
			pet.hint = getLangString(pet.hint);

			pkg.pets.add(pet);
		}
	}).add();

	// Providing customDescription to pets does not appear to work, so we hack it in.
	for (const pet of pets) {
		const pet_obj = game.pets.getObjectByID('kru_melvor_multiplayer:' + pet.id);
		pet_obj._customDescription = getLangString(pet.customDescription);
		skill_pets.set(pet.id, pet_obj);
	}
}

function has_pet_by_id(pet_id) {
	return game.petManager.unlocked.has(skill_pets.get(pet_id));
}
// #endregion

// #region CHARITY FUNCTIONS
async function request_charity_tree_contents() {
	state.charity_update_time = Date.now();

	if (state.charity_tree_loading)
		return;

	const current_time = Date.now();
	if (current_time < last_charity_check + CHARITY_CHECK_TIMEOUT)
		return;

	last_charity_check = current_time;
	state.charity_tree_loading = true;

	const res = await api_get('/api/charity/contents');
	if (res !== null)
		state.charity_tree_inventory = res.items;

	state.charity_tree_loading = false;
}
// #endregion

// #region TRANSFER FUNCTIONS
async function update_transfer_contents() {
	if (state.is_updating_transfer_contents)
		return;

	state.is_updating_transfer_contents = true;

	const missing_gifts = state.gifts.filter(gift => gift.data === null).map(gift => gift.id);
	const missing_trades = state.trades.filter(trade => trade.data === null).map(trade => trade.trade_id);
	const missing_resolved_trades = state.resolved_trades.filter(trade => trade.data === null).map(trade => trade.trade_id);

	if (missing_gifts.length > 0 || missing_trades.length > 0 || missing_resolved_trades.length > 0) {
		const res = await api_post('/api/transfers/get_contents', {
			gift_ids: missing_gifts,
			trade_ids: missing_trades,
			resolved_trade_ids: missing_resolved_trades
		});

		if (res !== null) {
			for (const gift of state.gifts) {
				const gift_data = res.gifts[gift.id];
				if (gift_data)
					gift.data = gift_data;
			}

			for (const trade of state.trades) {
				const trade_data = res.trades[trade.trade_id];
				if (trade_data)
					trade.data = trade_data;
			}

			for (const trade of state.resolved_trades) {
				const trade_data = res.resolved_trades[trade.trade_id];
				if (trade_data)
					trade.data = trade_data;
			}
		}
	}

	state.is_updating_transfer_contents = false;
}

function return_all_transfer_inventory() {
	for (const entry of state.transfer_inventory)
		add_bank_item(entry.id, entry.qty);

	state.transfer_inventory = [];
	update_transfer_inventory_nav();
}

function return_selected_transfer_inventory() {
	const selected_id = state.selected_transfer_item_id;
	if (selected_id.length > 0) {
		const entry = state.transfer_inventory.find(e => e.id === selected_id);
		if (entry) {
			add_bank_item(selected_id, entry.qty);
			state.transfer_inventory = state.transfer_inventory.filter(e => e.id !== selected_id);

			update_transfer_inventory_nav();
		}
	} else {
		notify_error('MOD_KMM_TRANSFER_NO_ITEM_SELECTED');
	}
}

function update_transfer_inventory_nav() {
	const aside = document.querySelector('.kmm-transfer-nav');
	aside.textContent = state.transfer_inventory.length + ' / ' + TRANSFER_INVENTORY_MAX_LIMIT;
	aside.classList.toggle('text-danger', state.transfer_inventory.length >= TRANSFER_INVENTORY_MAX_LIMIT);
}

function add_gp_to_transfer(amount) {
	if (game.gp.amount < amount)
		return notify_error('MOD_KMM_INSUFFICIENT_GP_ERR');

	const existing_entry = state.transfer_inventory.find(e => e.id === 'melvorD:GP');
	if (existing_entry) {
		existing_entry.qty += amount;
	} else {
		if (state.transfer_inventory.length >= TRANSFER_INVENTORY_MAX_LIMIT)
			return notify_error('MOD_KMM_TRANSFER_INVENTORY_FULL');

		state.transfer_inventory.unshift({
			id: 'melvorD:GP',
			qty: amount
		});
	}

	game.gp.remove(amount);
	update_transfer_inventory_nav();
	persist_transfer_inventory();
}

function add_item_to_transfer_inventory(item, qty) {
	const existing_entry = state.transfer_inventory.find(e => e.id === item.id);
	if (existing_entry) {
		existing_entry.qty += qty;
	} else {
		if (state.transfer_inventory.length >= TRANSFER_INVENTORY_MAX_LIMIT)
			return notify_error('MOD_KMM_TRANSFER_INVENTORY_FULL');

		state.transfer_inventory.push({
			id: item.id,
			qty: qty
		});
	}

	game.bank.removeItemQuantity(item, qty);
	update_transfer_inventory_nav();
	persist_transfer_inventory();
}

function persist_transfer_inventory() {
	set_character_storage_item('transfer_inventory', state.transfer_inventory);
}

function load_transfer_inventory() {
	const stored = get_character_storage_item('transfer_inventory');
	state.transfer_inventory = stored ?? [];
	update_transfer_inventory_nav();
}
// #endregion

// #region API FUNCTIONS
async function api_get(endpoint) {
	const res = await fetch(SERVER_HOST + endpoint, {
		method: 'GET',
		headers: {
			'X-Session-Token': session_token ?? undefined
		}
	});

	if (res.status === 200)
		return res.json();

	return null;
}

async function api_post(endpoint, payload) {
	const res = await fetch(SERVER_HOST + endpoint, {
		method: 'POST',
		body: JSON.stringify(payload),
		headers: {
			'Content-Type': 'application/json',
			'X-Session-Token': session_token ?? undefined
		}
	});

	if (res.status === 200)
		return res.json();

	return null;
}

function set_session_token(token) {
	session_token = token;
	state.is_connected = true;
	log('client session authenticated (%s)', token);
}

async function get_friends() {
	const res = await api_get('/api/friends/get');
	if (res !== null)
		state.friends = res.friends;
}

async function get_client_events() {
	const res = await api_get('/api/events');
	if (res !== null) {
		state.events.friend_requests = res.friend_requests;
		state.market_completed = res.market_completed;

		for (const trade of res.trades) {
			// .trade_id, .attending, .state
			const cache_trade = state.trades.find(e => e.trade_id === trade.trade_id);
			if (cache_trade) {
				if (cache_trade.state !== trade.state) {
					// remove the existing trade from trades
					state.trades = state.trades.filter(e => e.trade_id !== trade.trade_id);

					setTimeout(() => {
						state.trades.push({
							trade_id: cache_trade.trade_id,
							state: trade.state,
							attending: trade.attending,
							data: null
						});
					}, 1);
				}
			} else {
				state.trades.push(Object.assign({ data: null }, trade));
			}
		}

		for (const trade_id of res.resolved_trades) {
			if (!state.resolved_trades.some(e => e.trade_id === trade_id))
				state.resolved_trades.push({ trade_id, data: null });
		}
		
		for (const gift_id of res.gifts) {
			if (!state.gifts.some(e => e.id === gift_id))
				state.gifts.push({ id: gift_id, data: null });
		}

		if (state.campaign_active && !res.campaign.active) {
			// campaign no longer active, ditch known data client-side
			state.campaign_id = '';
			state.campaign_item_id = '';
			state.campaign_item_total = 0;
			state.campaign_contribution = 0;
		}

		const campaign_state_changed = state.campaign_active !== res.campaign.active;

		state.campaign_pct = res.campaign.pct;
		state.campaign_active = res.campaign.active;

		if (campaign_state_changed) {
			state.campaign_has_data = false;
			update_campaign_info();
		}

		update_campaign_nav();

		if (state.is_transfer_page_visible)
			setTimeout(() => update_transfer_contents(), 1);
	}

	setTimeout(get_client_events, 60000);
}
// #region

// #region SETUP FUNCTIONS
export async function setup(ctx) {
	await patch_localization(ctx);
	await ctx.loadTemplates('ui/templates.html');

	await load_pets(ctx);
	await ctx.gameData.addPackage('data.json');

	load_campaign_data(ctx);

	ctx.onCharacterLoaded(() => {
		start_multiplayer_session();
		load_transfer_inventory();

		state.charity_timeout = get_character_storage_item('charity_timeout') ?? 0;
		state.charity_bonus_timeout = get_character_storage_item('charity_bonus_timeout') ?? 0;

		state.charity_bonus_unlocked = has_pet_by_id('Multiplayer_Pet_Charity');
	});

	sidebar.category('Multiplayer', { before: 'Combat' });
	
	ctx.onInterfaceReady(() => {
		const $button_tray = document.getElementById('header-theme').querySelector('.align-items-right');

		make_template('online-button', $button_tray);
		make_template('dropdown', $('kru-mm-online-button-container'));

		state.$dropdown_menu = $('kru-mm-online-dropdown');

		const $main_container = $('main-container');
		for (const page of ['transfer', 'charity', 'campaign', 'market'])
			make_template(page + '-page', $main_container);

		patch_bank();
		patch_bank_market();
		
		on_page_toggle('kru-multiplayer-charity-page', () => request_charity_tree_contents(), true);
		on_page_toggle('kru-multiplayer-campaign-page', () => update_campaign_info(), true);
		on_page_toggle('kru-multiplayer-market-page', () => update_market_page(), true);
	});
}

function setup_icons() {
	if (state.available_icons.length === 0) {
		const namespace_maps = game.items.namespaceMaps;
		state.available_icons = [...namespace_maps.get('melvorF'), ...namespace_maps.get('melvorD')].map(e => {
			const item = e[1];
			return {id: item.id, search_name: item.name.toLowerCase(), media: item.media };
		});
	}
}

function patch_bank_market() {
	const $bank_item_menu = document.querySelector('bank-selected-item-menu');
	const $gutter = $bank_item_menu.querySelector('.gutters-tiny');

	make_template('bank-market-container', $gutter);

	const $slider_element = document.getElementById('kmm-market-slider');
	const slider = new BankRangeSlider($slider_element);

	let selected_bank_item = null;
	let sell_price = 1;

	const $sell_value = document.getElementById('kmm-market-sell-value');
	function update_sell_value() {
		const amount = slider.quantity;
		const sell_total = amount * sell_price;

		$sell_value.textContent = selected_bank_item.item.sellsFor.currency.formatAmount(numberWithCommas(sell_total));
	}

	const $sell_amount_input = document.getElementById('kmm-market-sell-amount');
	const $sell_price_input = document.getElementById('kmm-market-sell-price');

	function update_bank_item(orig_func, ...args) {
		orig_func.call(this, ...args);

		selected_bank_item = args[0];
		sell_price = game.bank.getItemSalePrice(selected_bank_item.item);
		$sell_price_input.value = sell_price;

		slider.setSliderRange(selected_bank_item);
		update_sell_value();
	}

	const orig_update_item_quantity = $bank_item_menu.updateItemQuantity;
	$bank_item_menu.updateItemQuantity = function(...args) {
		update_bank_item.call(this, orig_update_item_quantity, ...args);
	}

	const orig_set_item = $bank_item_menu.setItem;
	$bank_item_menu.setItem = function(...args) {
		update_bank_item.call(this, orig_set_item, ...args);
	}

	$sell_amount_input.addEventListener('input', () => slider.setSliderPosition($sell_amount_input.value));

	$sell_price_input.addEventListener('input', () => {
		sell_price = parseInt($sell_price_input.value);
		update_sell_value();
	});

	slider.customOnChange = (amount) => {
		$sell_amount_input.value = amount;
		update_sell_value();
	};

	const $market_sell_button = document.getElementById('kmm-market-sell-button');
	$market_sell_button.addEventListener('click', async () => {
		if (is_button_spinning($market_sell_button))
			return;

		show_button_spinner($market_sell_button);
		await market_create_listing(selected_bank_item.item, slider.quantity, sell_price);
		hide_button_spinner($market_sell_button);
	});
}

function patch_bank() {
	const $bank_item_menu = document.querySelector('bank-selected-item-menu');
	const $gutter = $bank_item_menu.querySelector('.gutters-tiny');

	make_template('bank-container', $gutter);

	const $slider_element = document.getElementById('kmm-transfer-slider');
	const slider = new BankRangeSlider($slider_element);

	let selected_bank_item = null;

	const $transfer_value = document.getElementById('kmm-transfer-value');

	function update_transfer_value() {
		const amount = slider.quantity;
		$transfer_value.textContent = selected_bank_item.item.sellsFor.currency.formatAmount(numberWithCommas(game.bank.getItemSalePrice(selected_bank_item.item, amount)));
	}

	function update_bank_item(orig_func, ...args) {
		orig_func.call(this, ...args);

		selected_bank_item = args[0];
		slider.setSliderRange(selected_bank_item);
		update_transfer_value();
	}

	const orig_update_item_quantity = $bank_item_menu.updateItemQuantity;
	$bank_item_menu.updateItemQuantity = function(...args) {
		update_bank_item.call(this, orig_update_item_quantity, ...args);
	}

	const orig_set_item = $bank_item_menu.setItem;
	$bank_item_menu.setItem = function(...args) {
		update_bank_item.call(this, orig_set_item, ...args);
	}

	const $transfer_input = document.getElementById('kmm-transfer-amount');
	$transfer_input.addEventListener('input', () => slider.setSliderPosition($transfer_input.value));

	slider.customOnChange = (amount) => {
		$transfer_input.value = amount;
		update_transfer_value();
	};

	const $transfer_all_button = document.getElementById('kmm-transfer-all');
	$transfer_all_button.addEventListener('click', () => slider.setSliderPosition(Infinity));

	const $transfer_all_but_1_button = document.getElementById('kmm-transfer-all-but-1');
	$transfer_all_but_1_button.addEventListener('click', () => slider.setSliderPosition(slider.sliderMax - 1));

	const $transfer_button = document.getElementById('kmm-transfer-button');
	$transfer_button.addEventListener('click', () => {
		add_item_to_transfer_inventory(selected_bank_item.item, slider.quantity);
	});

	// detect data page open
	on_page_toggle('kru-multiplayer-transfer-page', is_visible => {
		state.is_transfer_page_visible = is_visible;
		if (is_visible)
			update_transfer_contents();
	});
}

/** Patches the global fetchLanguageJSON() fn so we can load and inject our own
 * translations. This is a hackfix because I couldn't find a way for mods to load
 * their own translations via data. */
async function patch_localization(ctx) {
	const lang_supported = ['en'];

	const fetch_mod_localization = async (lang) => {
		const fetch_lang = lang_supported.includes(lang) ? lang : 'en';

		try {
			const patch_lang = await ctx.loadData('data/lang/' + fetch_lang + '.json');
			for (const [key, value] of Object.entries(patch_lang))
				loadedLangJson[key] = value;
		} catch (e) {
			error('Failed to patch localization for %s (%s)', fetch_lang, e);
		}
	};

	const orig_fetchLanguageJSON = globalThis.fetchLanguageJSON;
	globalThis.fetchLanguageJSON = async (lang) => {
		await orig_fetchLanguageJSON(lang);
		await fetch_mod_localization(lang);
	}

	if (loadedLangJson !== undefined)
		await fetch_mod_localization(setLang);
}

async function start_multiplayer_session() {
	if (is_connecting)
		return;

	is_connecting = true;

	const client_identifier = get_character_storage_item('client_identifier');
	const client_key = get_character_storage_item('client_key');
	const display_name = game.characterName;

	if (client_identifier !== undefined && client_key !== undefined) {
		log('existing client identity found, authenticating session...');
		const auth_res = await api_post('/api/authenticate', {
			client_identifier,
			client_key,
			display_name
		});

		if (auth_res !== null) {
			set_session_token(auth_res.session_token);
			state.profile_icon = auth_res.icon_id;

			get_client_events();
			get_friends();
		} else {
			notify_error('MOD_KMM_MULTIPLAYER_CONNECTION_ERR');
			error('failed to authenticate client, multiplayer features not available');
		}
	} else {
		log('missing client identity, registering new identity...');
		const client_key = crypto.randomUUID();

		const register_res = await api_post('/api/register', {
			client_key,
			display_name
		});

		if (register_res !== null) {
			set_character_storage_item('client_key', client_key);
			set_character_storage_item('client_identifier', register_res.client_identifier);
			set_character_storage_item('friend_code', register_res.friend_code);

			state.profile_icon = register_res.icon_id;

			set_session_token(register_res.session_token);
			get_client_events();
			get_friends();
		} else {
			notify_error('MOD_KMM_MULTIPLAYER_CONNECTION_ERR');
			error('failed to register client, multiplayer features not available');
		}
	}

	is_connecting = false;
}
// #endregion

// #region COMPONENTS
class KMMModalComponent extends HTMLElement {
	constructor() {
		super();

		const template_id = this.getAttribute('data-template-id');
		make_template(template_id, this);
	}
}

class LangStringFormattedElement extends HTMLElement {
	constructor() {
		super();
	}

	connectedCallback() {
		this.updateTranslation();
	}

	updateTranslation() {
		const lang_id = this.getAttribute('lang-id');
		
		if (lang_id === null) {
			this.textContent = 'Language ID Undefined';
			return;
		}

		let translated_string = getLangString(`${lang_id}`);
		
		const format_args = [];
		let i = 1;
		while (this.hasAttribute(`lang-arg-${i}`)) {
			format_args.push(this.getAttribute(`lang-arg-${i}`));
			i++;
		}

		if (format_args.length > 0)
			translated_string = this.formatString(translated_string, format_args);
		
		this.textContent = translated_string;
	}

	formatString(str, args) {
		return str.replace(/%s/g, () => args.shift() || '');
	}

	attributeChangedCallback(name, oldValue, newValue) {
		this.updateTranslation();
	}

	static get observedAttributes() {
		return ['lang-id', ...Array.from({length: 10}, (_, i) => `lang-arg-${i+1}`)];
	}
}

class KMMItemIcon extends HTMLElement {
	constructor() {
		super();
	}

	createUnsupportedItemTooltip() {
		return `<div class="text-center">
				<div class="media d-flex align-items-center push">
					<div class="mr-3">
						<img class="bank-img m-1" src="assets/media/main/question.png">
					</div>
					<div class="media-body">
						<div class="font-w600 text-danger">Unsupported Item</div>
						<div role="separator" class="dropdown-divider m-0 mb-1"></div>
						<small class="text-info">This item will not be added to your inventory.</small>
					</div>
				</div>
		</div>`;
	}

	createGPTooltip() {
		return `<div class="text-center">
				<div class="media d-flex align-items-center push">
					<div class="mr-3">
						<img class="bank-img m-1" src="assets/media/main/coins.png">
					</div>
					<div class="media-body">
						<div class="font-w600">Gold (GP)</div>
						<div role="separator" class="dropdown-divider m-0 mb-1"></div>
						<small class="text-info">The currency of Melvor!</small>
					</div>
				</div>
		</div>`;
	}

	connectedCallback() {
		const item_id = this.getAttribute('data-item-id');
		this.item = game.items.getObjectByID(item_id);

		this.tooltip = tippy(this, {
			content: '',
			placement: 'top',
			allowHTML: true,
			interactive: false,
			animation: false,
			touch: 'hold',
			onShow: (instance) => {
				if (item_id === 'melvorD:GP')
					instance.setContent(this.createGPTooltip());
				else if (this.item !== undefined)
					instance.setContent(createItemInformationTooltip(this.item));
				else
					instance.setContent(this.createUnsupportedItemTooltip());
			}
		});
	}
}

class KMMGPSlider extends HTMLElement {
	constructor() {
		super();

		state.add_gp_value = 1;

		const $input = document.createElement('input');
		$input.type = 'text';

		this.appendChild($input);

		this.slider = new BankRangeSlider($input);

		this.slider.sliderMax = game.gp.amount;
		this.slider.sliderMin = 1;

		this.slider.sliderInstance.update({
			min: 1,
			max: game.gp.amount
		});

		const $value = document.createElement('input');
		$value.classList.add('form-control', 'mt-2');
		$value.type = 'number';
		$value.value = 1;

		$value.addEventListener('input', () => this.slider.setSliderPosition($value.value));
		this.slider.customOnChange = (amount) => {
			$value.value = amount;
			state.add_gp_value = amount;
		};

		this.appendChild($value);
	}
}

class KMMItemSlider extends HTMLElement {
	constructor() {
		super();

		const max = this.getMax();
		state.item_slider_value = 0;

		const $input = document.createElement('input');
		$input.type = 'text';

		this.appendChild($input);

		this.slider = new BankRangeSlider($input);

		this.slider.sliderMax = max;
		this.slider.sliderMin = 0;

		this.slider.sliderInstance.update({
			min: 0,
			max
		});

		const $value = document.createElement('input');
		$value.classList.add('form-control', 'mt-2');
		$value.type = 'number';
		$value.value = 0;

		$value.addEventListener('input', () => this.slider.setSliderPosition($value.value));
		this.slider.customOnChange = (amount) => {
			$value.value = amount;
			state.item_slider_value = amount;
		};

		this.appendChild($value);
	}

	getMax() {
		const item_id = this.getAttribute('data-item-id');
		return parseInt(this.getAttribute('data-max') ?? game.bank.getQty(game.items.getObjectByID(item_id)));	
	}

	attributeChangedCallback(name, oldValue, newValue) {
		const max = this.getMax();

		this.slider.sliderMax = max;
		this.slider.sliderMin = 0;

		this.slider.sliderInstance.update({
			min: 0,
			max: max
		});
	}

	static get observedAttributes() {
		return ['data-item-id', 'data-max'];
	}
}

window.customElements.define('lang-string-f', LangStringFormattedElement);
window.customElements.define('kmm-modal-component', KMMModalComponent);
window.customElements.define('kmm-item-icon', KMMItemIcon);
window.customElements.define('kmm-gp-slider', KMMGPSlider);
window.customElements.define('kmm-item-slider', KMMItemSlider);
// #endregion