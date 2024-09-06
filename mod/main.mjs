const SERVER_HOST = 'https://melvormultiplayer.net';
const LOG_PREFIX = '[multiplayer] ';

const IS_DEV_MODE = true;
const DEV_CHARACTER_STORAGE = {
	client_identifier: '8adeec2c-2cb6-444d-8acd-b06b45041be5',
	client_key: '3796db67-a7da-4be8-9828-2483db800d5f'
};

let session_token = null;

const ctx = mod.getContext(import.meta);
const state = ui.createStore({
	// todo
});

function notify_error(lang_id, icon) {
	notify(lang_id, 'danger', icon);
}

function notify(lang_id, theme = 'danger', icon = 'assets/archaeology.svg') {
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

async function start_mutliplayer_session(ctx) {
	const client_identifier = get_character_storage_item('client_identifier');
	const client_key = get_character_storage_item('client_key');

	if (client_identifier !== undefined && client_key !== undefined) {
		log('existing client identity found, authenticating session...');
		const auth_res = await api_post('/api/authenticate', {
			client_identifier,
			client_key
		});

		if (auth_res !== null) {
			set_session_token(auth_res.session_token);
		} else {
			// todo: implement a fallback to allow players to reconnect
			error('failed to authenticate client, multiplayer features not available');
		}
	} else {
		log('missing client identity, registering new identity...');
		const client_key = crypto.randomUUID();

		const register_res = await api_post('/api/register', {
			client_key
		});

		if (register_res !== null) {
			set_character_storage_item('client_key', client_key);
			set_character_storage_item('client_identifier', register_res.client_identifier);

			set_session_token(register_res.session_token);
		} else {
			// todo: implement a fallback to allow players to reconnect
			error('failed to register client, multiplayer features not available');
		}
	}
}

export async function setup(ctx) {
	await patch_localization(ctx);
	await ctx.loadTemplates('ui/templates.html');
	
	//ui.create({ $template: '#template-kru-archaeology-container', state	}, document.body);
	//ui.create({ $template: '#template-kru-archaeology-bank-options', state }, document.body);

	ctx.onCharacterLoaded(() => {
		start_mutliplayer_session(ctx);

		setInterval(async () => {
			console.log(await api_get('/api/test'));
		}, 2500);
	});
	
	ctx.onInterfaceReady(() => {
		console.log('melvor_multiplayer: onInterfaceReady');
		// player logged in
	});
}