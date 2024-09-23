const SERVER_HOST = 'https://melvormultiplayer.net';
const LOG_PREFIX = '[multiplayer] ';

const IS_DEV_MODE = true;
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

let session_token = null;
let is_connecting = false;

const ctx = mod.getContext(import.meta);
const state = ui.createStore({
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

	transfer_inventory: [],
	selected_transfer_item_id: '',

	events: {
		friend_requests: []
	},

	trades: [],
	gifts: [],
	resolved_trades: [],

	available_icons: [],

	friends: [],

	get transfer_inventory_value() {
		let total_value = 0;

		for (const entry of this.transfer_inventory) {
			const item = game.items.getObjectByID(entry.id);
			if (item?.sellsFor.currency === game.gp)
				total_value += game.bank.getItemSalePrice(item, entry.qty);
		}

		return game.gp.formatAmount(numberWithCommas(total_value));
	},

	get filtered_icons() {
		const icon_search_lower = this.icon_search.toLowerCase();
		return this.available_icons.filter(icon => icon.search_name.includes(icon_search_lower)).slice(0, 32);
	},

	get num_notifications() {
		return this.num_friend_requests + this.num_transfer_offers;
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

	create_trade() {
		if (state.transfer_inventory.length > 0) {
			queue_modal('MOD_KMM_TITLE_SEND_TRADE_OFFER', 'create-trade-modal', 'assets/media/bank/fine_coinpurse.png', {
				showConfirmButton: false
			}, true, false);
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

	is_returned_gift(gift) {
		return (gift.data.flags & GIFT_FLAG_RETURNED) !== 0;
	},

	get_transfer_value(transfer) {
		if (transfer.data === null)
			return '...';

		let total_value = 0;

		for (const entry of transfer.data.items) {
			const item = game.items.getObjectByID(entry.item_id);
			if (item?.sellsFor.currency === game.gp)
				total_value += game.bank.getItemSalePrice(item, entry.qty);
		}

		return game.gp.formatAmount(numberWithCommas(total_value));
	},

	async resolve_gift(event, gift_id, accept) {
		const $button = event.currentTarget;

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
						game.bank.addItemByID(item.item_id, item.qty, false, false, true);
				}
			}

			this.gifts = this.gifts.filter(g => g.id !== gift_id);
		} else {
			notify_error('MOD_KMM_GENERIC_ERR');
		}
	},

	get_svg(id) {
		return ctx.getResourceUrl('assets/' + id + '.svg');
	},

	get_svg_url(id) {
		return 'url(' + this.get_svg(id) + ')';
	},

	get_item_icon(id) {
		const item = game.items.getObjectByID(id);
		return item?.media ?? 'assets/media/main/question.png';
	},

	close_modal() {
		Swal.close();
	},

	pick_icon(icon) {
		this.picked_icon = icon.id;

		const $image = document.querySelector('.swal2-image');

		if ($image)
			$image.src = icon.media;
	},

	async confirm_icon_pick(event) {
		show_button_spinner(event.currentTarget);

		const res = await api_post('/api/client/set_icon', { icon_id: this.picked_icon });
		if (res?.success)
			this.profile_icon = this.picked_icon;

		this.close_modal();
	},

	open_transfer_data_page() {
		state.hide_online_dropdown();
		changePage(game.pages.getObjectByID('kru_melvor_multiplayer:Transfer_Items'));
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

	show_icon_modal() {
		this.hide_online_dropdown();
		setup_icons();

		state.picked_icon = '';

		queue_modal(game.characterName, 'change-icon-modal', game.items.getObjectByID(state.profile_icon).media, {
			showConfirmButton: false
		}, false, false);
	},

	async accept_friend_request(event, request) {
		const $button = event.currentTarget;
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

	get_trade_items_value(items) {
		let total_value = 0;

		for (const entry of items) {
			const item = game.items.getObjectByID(entry.item_id);
			if (item?.sellsFor.currency === game.gp)
				total_value += game.bank.getItemSalePrice(item, entry.qty);
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
		show_button_spinner($button);

		const res = await api_post('/api/trade/resolve', { trade_id });

		hide_button_spinner($button);

		if (res?.success === true) {
			for (const item of trade.data.items)
				game.bank.addItemByID(item.item_id, item.qty, false, false, true);

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
		show_button_spinner($button);

		const res = await api_post('/api/trade/decline', { trade_id });
		hide_button_spinner($button);

		if (res?.success === true) {
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
		show_button_spinner($button);

		const res = await api_post('/api/trade/cancel', { trade_id });
		hide_button_spinner($button);

		if (res?.success === true) {
			let items = trade.data.items;

			if (trade.state === 1)
				items = items.filter(item => item.counter === 1);

			for (const item of trade.data.items)
				game.bank.addItemByID(item.item_id, item.qty, false, false, true);
			
			state.trades = state.trades.filter(trade => trade.trade_id !== trade_id);
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

	remove_friend_prompt(friend) {
		this.close_modal();

		state.removing_friend = friend;

		queue_modal('MOD_KMM_TITLE_REMOVE_FRIEND_CONFIRM', 'remove-friend-modal', 'assets/remove_friend.svg', {
			showConfirmButton: false
		});
	},

	async remove_friend($event) {
		show_button_spinner($event.currentTarget);
		const friend_id = state.removing_friend.friend_id;

		const res = await api_post('/api/friends/remove', { friend_id });

		if (res?.success) {
			state.friends = state.friends.filter(f => f.friend_id !== friend_id);
			notify('MOD_KMM_NOTIF_FRIEND_REMOVED');
		}

		state.close_modal();
	},

	show_friends_modal() {
		state.hide_online_dropdown();
		queue_modal('MOD_KMM_TITLE_FRIENDS', 'friends-modal');
	},

	show_friend_request_modal() {
		state.hide_online_dropdown();
		queue_modal('MOD_KMM_TITLE_FRIEND_REQUESTS', 'friend-request-modal');
	},

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

	transfer_return_selected() {
		return_selected_transfer_inventory();
	},

	transfer_return_all() {
		return_all_transfer_inventory();
	}
});

function setup_icons() {
	if (state.available_icons.length === 0) {
		const namespace_maps = game.items.namespaceMaps;
		state.available_icons = [...namespace_maps.get('melvorF'), ...namespace_maps.get('melvorD')].map(e => {
			const item = e[1];
			return {id: item.id, search_name: item.name.toLowerCase(), media: item.media };
		});
	}
}

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

function notify(lang_id, theme = undefined, icon = 'assets/multiplayer.svg') {
	notifyPlayer({ media: ctx.getResourceUrl(icon) }, getLangString(lang_id), theme);
}

function log(message, ...params) {
	console.log(LOG_PREFIX + message, ...params);
}

function error(message, ...params) {
	console.error(LOG_PREFIX + message, ...params);
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
	const $transfer_page = $('kru-multiplayer-transfer-page');

	const observer = new MutationObserver(() => {
		const is_visible = !$transfer_page.classList.contains('d-none');
		state.is_transfer_page_visible = is_visible;
		
		if (is_visible)
			update_transfer_contents();
	});

	observer.observe($transfer_page, {
		attributes: true,
		attributeFilter: ['class']
	});
}

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
		game.bank.addItemByID(entry.id, entry.qty, false, false, true);

	state.transfer_inventory = [];
	update_transfer_inventory_nav();
}

function return_selected_transfer_inventory() {
	const selected_id = state.selected_transfer_item_id;
	if (selected_id.length > 0) {
		const entry = state.transfer_inventory.find(e => e.id === selected_id);
		if (entry) {
			game.bank.addItemByID(selected_id, entry.qty, false, false, true);
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
					console.log('got existing trade %d with different state (wiping data)', trade.trade_id);
				} else {
					console.log('got existing trade %d, no different', trade.trade_id);
				}
			} else {
				console.log('got new trade meta %d, adding to cache', trade.trade_id);
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

		if (state.is_transfer_page_visible)
			setTimeout(() => update_transfer_contents(), 1);
	}

	setTimeout(get_client_events, 60000);
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

export async function setup(ctx) {
	await patch_localization(ctx);
	await ctx.loadTemplates('ui/templates.html');

	await ctx.gameData.addPackage('data.json');

	ctx.onCharacterLoaded(() => {
		start_multiplayer_session();
		load_transfer_inventory();
	});
	
	ctx.onInterfaceReady(() => {
		const $button_tray = document.getElementById('header-theme').querySelector('.align-items-right');

		make_template('online-button', $button_tray);
		make_template('dropdown', $('kru-mm-online-button-container'));

		state.$dropdown_menu = $('kru-mm-online-dropdown');

		make_template('transfer-page', $('main-container'));

		patch_bank();
	});
}

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
			onShow: (instance)=>{
				if (this.item !== undefined)
					instance.setContent(createItemInformationTooltip(this.item));
				else
					instance.setContent(this.createUnsupportedItemTooltip());
			}
		});
	}
}

window.customElements.define('lang-string-f', LangStringFormattedElement);
window.customElements.define('kmm-modal-component', KMMModalComponent);
window.customElements.define('kmm-item-icon', KMMItemIcon);