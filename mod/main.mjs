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

export async function setup(ctx) {
	await ctx.loadTemplates('ui/templates.html');
	
	//ui.create({ $template: '#template-kru-archaeology-container', state	}, document.body);
	//ui.create({ $template: '#template-kru-archaeology-bank-options', state }, document.body);

	ctx.onCharacterLoaded(() => {
		console.log('melvor_multiplayer: onCharacterLoaded');
	});
	
	ctx.onInterfaceReady(() => {
		console.log('melvor_multiplayer: onInterfaceReady');
		// player logged in
	});
}