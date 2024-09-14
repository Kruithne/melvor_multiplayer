const SERVER_HOST = 'https://melvormultiplayer.net';
const LOG_PREFIX = '[multiplayer] ';

const IS_DEV_MODE = true;
const DEV_CHARACTER_STORAGE = {
	client_identifier: '04fcad4c-7df5-43c3-a70e-299cd618a0ab',
	client_key: 'f88596d3-e2b2-4a50-9754-6b05f1a15bac',
	friend_code: '689-388-847'
};

let session_token = null;
let is_connecting = false;

const ctx = mod.getContext(import.meta);
const state = ui.createStore({
	removingFriend: null,
	friend_code: '',

	events: {
		friend_requests: []
	},

	friends: [],

	get num_notifications() {
		return this.num_friend_requests;
	},

	get num_friend_requests() {
		return this.events.friend_requests.length;
	},

	get_svg(id) {
		return ctx.getResourceUrl('assets/' + id + '.svg');
	},

	get_svg_url(id) {
		return 'url(' + this.get_svg(id) + ')';
	},

	close_modal() {
		Swal.close();
	},

	toggle_online_dropdown() {
		const class_list = state.$dropdown_menu.classList;
		class_list.toggle('show');
		class_list.toggle('connected', session_token !== null);
	},

	hide_online_dropdown() {
		state.$dropdown_menu.classList.remove('show');
	},

	reconnect() {
		state.hide_online_dropdown();
		start_multiplayer_session();
	},

	async accept_friend_request(event, request) {
		show_button_spinner(event.currentTarget);

		const res = await api_post('/api/friends/accept', {
			request_id: request.request_id
		});

		if (res?.success === true) {
			state.events.friend_requests.splice(state.events.friend_requests.indexOf(request), 1);

			if (res.friend)
				state.friends.push(res.friend);
		} else {
			hide_button_spinner(event.currentTarget);
			notify_error('MOD_KMM_GENERIC_ERR');
		}
	},

	async ignore_friend_request(event, request) {
		show_button_spinner(event.currentTarget);

		const res = await api_post('/api/friends/ignore', {
			request_id: request.request_id
		});

		if (res?.success === true) {
			state.events.friend_requests.splice(state.events.friend_requests.indexOf(request), 1);
		} else {
			hide_button_spinner(event.currentTarget);
			notify_error('MOD_KMM_GENERIC_ERR');
		}
	},

	async remove_friend_prompt(friend) {
		this.close_modal();

		state.removingFriend = friend;

		queue_modal('MOD_KMM_TITLE_REMOVE_FRIEND_CONFIRM', 'remove-friend-modal', 'assets/remove_friend.svg', {
			showConfirmButton: false
		});
	},

	async remove_friend($event) {
		show_button_spinner($event.currentTarget);
		const friend_id = state.removingFriend.friend_id;

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

		notify('MOD_KMM_NOTIF_FRIEND_REQ_SENT');
		state.close_modal();
	}
});

function queue_modal(title_lang, template_id, image_url = 'assets/multiplayer.svg', data = {}) {
	addModalToQueue(Object.assign({
		title: getLangString(title_lang),
		html: modal_component(template_id),
		imageUrl: ctx.getResourceUrl(image_url),
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
	return ui.create({ $template: '#template-kru-multiplayer-' + id, state }, parent ?? document);
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
	log('client session authenticated (%s)', token);
}

async function get_friends() {
	const res = await api_get('/api/friends/get');
	if (res !== null)
		state.friends = res.friends;
}

async function get_client_events() {
	const res = await api_get('/api/events');
	if (res !== null)
		state.events = res;

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

	ctx.onCharacterLoaded(() => {
		start_multiplayer_session();
	});
	
	ctx.onInterfaceReady(() => {
		const $button_tray = document.getElementById('header-theme').querySelector('.align-items-right');
		ui.create({ $template: '#template-kru-multiplayer-online-button', state }, $button_tray);
		ui.create({ $template: '#template-kru-multiplayer-dropdown', state }, $('kru-mm-online-button-container'));

		state.$dropdown_menu = $('kru-mm-online-dropdown');
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

window.customElements.define('lang-string-f', LangStringFormattedElement);
window.customElements.define('kmm-modal-component', KMMModalComponent);