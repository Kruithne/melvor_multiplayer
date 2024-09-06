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
			console.error('Failed to patch localization for %s (%s)', fetch_lang, e);
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

export async function setup(ctx) {
	await patch_localization(ctx);
	await ctx.loadTemplates('ui/templates.html');
	
	//ui.create({ $template: '#template-kru-archaeology-container', state	}, document.body);
	//ui.create({ $template: '#template-kru-archaeology-bank-options', state }, document.body);

	ctx.onCharacterLoaded(async () => {
		console.log('melvor_multiplayer: onCharacterLoaded');

		const test = await fetch('https://melvormultiplayer.net/test');
		console.log(test);
	});
	
	ctx.onInterfaceReady(() => {
		console.log('melvor_multiplayer: onInterfaceReady');
		// player logged in
	});
}