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
	get_svg(id) {
		return ctx.getResourceUrl('assets/' + id + '.svg');
	},

	get_svg_url(id) {
		return 'url(' + this.get_svg(id) + ')';
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

	show_friend_code_modal() {
		state.hide_online_dropdown();

		addModalToQueue({
			title: getLangString('MOD_KMM_TITLE_FRIEND_CODE'),
			html: custom_element_tag('kmm-friend-code-modal'),
			imageUrl: ctx.getResourceUrl('assets/multiplayer.svg'),
			imageWidth: 64,
			imageHeight: 64,
			allowOutsideClick: true,
			backdrop: true
		});
	},

	show_add_friend_modal() {
		state.hide_online_dropdown();

		addModalToQueue({
			title: getLangString('MOD_KMM_TITLE_ADD_FRIEND'),
			html: custom_element_tag('kmm-add-friend-modal'),
			imageUrl: ctx.getResourceUrl('assets/multiplayer.svg'),
			imageWidth: 64,
			imageHeight: 64,
			allowOutsideClick: true,
			backdrop: true,
			showConfirmButton: false
		})
	}
});

function show_modal_error(text) {
	const $modal_error = $('kmm-modal-error');
	$modal_error.textContent = text;
	$modal_error.classList.remove('d-none');
}

function hide_modal_error() {
	$('kmm-modal-error').classList.add('d-none');
}

function hook_modal_cancel(id) {
	$(id).addEventListener('click', () => Swal.close());
}

function hook_modal_confirm(id, callback, spinner) {
	$(id).addEventListener('click', async () => {
		if (spinner)
			show_button_spinner(id);

		const res = await callback();

		if (spinner)
			hide_button_spinner(id);

		if (res)
			Swal.close();
	});
}

function show_button_spinner(id) {
	const $element = $(id);
	const $spinner = $element.querySelector('.spinner-border');
	$spinner.classList.remove('d-none');
}

function hide_button_spinner(id) {
	const $element = $(id);
	const $spinner = $element.querySelector('.spinner-border');
	$spinner.classList.add('d-none');
}

function custom_element_tag(tag) {
	return `<${tag}></${tag}>`;
}

function make_template(id, parent = null) {
	const template = document.getElementById('template-kru-multiplayer-' + id);
	const node = template.content.cloneNode(true);

	parent?.appendChild(node);
	return node;
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

function connect_event_pipe() {
	const event_source = new EventSource('/pipe/events');
	event_source.addEventListener('test_message', event => {
		const data = JSON.parse(event.data);
		console.log(data);
	});
}

function set_session_token(token) {
	session_token = token;
	log('client session authenticated (%s)', token);
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
		} else {
			notify_error('MOD_KMM_MULTIPLAYER_CONNECTION_ERR');
			error('failed to register client, multiplayer features not available');
		}
	}

	connect_event_pipe();

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

class KMMFriendCodeModal extends HTMLElement {
	constructor() {
		super();

		make_template('friend-code-modal', this);

		const $input = this.querySelector('.kru-mm-input-text');
		$input.value = get_character_storage_item('friend_code');

		$input.focus();
		$input.select();
	}
}

class KMMAddFriendModal extends HTMLElement {
	constructor() {
		super();

		make_template('add-friend-modal', this);

		const CONFIRM_BTN_ID = 'kmm-modal-confirm-btn';

		hook_modal_confirm(CONFIRM_BTN_ID, async () => {
			hide_modal_error();

			const friend_code = $('kmm-add-friend-modal-field').value.trim();

			if (!/^\d{3}-\d{3}-\d{3}$/.test(friend_code)) {
				show_modal_error(getLangString('MOD_KMM_INVALID_FRIEND_CODE_ERR'));
				return false;
			}

			const client_friend_code = get_character_storage_item('friend_code');
			if (friend_code === client_friend_code) {
				show_modal_error(getLangString('MOD_KMM_NO_SELF_LOVE_ERR'));
				return false;
			}

			const res = await api_post('/api/friends/add', { friend_code });
			if (res === null) {
				show_modal_error(getLangString('MOD_KMM_GENERIC_ERR'));
				return false;
			}

			if (res.error_lang) {
				show_modal_error(getLangString(res.error_lang));
				return false;
			}

			notify('MOD_KMM_NOTIF_FRIEND_REQ_SENT');

			return true;
		}, true);

		hook_modal_cancel('kmm-modal-cancel-btn');
	}
}

window.customElements.define('kmm-friend-code-modal', KMMFriendCodeModal);
window.customElements.define('kmm-add-friend-modal', KMMAddFriendModal);