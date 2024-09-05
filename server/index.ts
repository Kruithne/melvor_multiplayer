import { caution, serve, HTTP_STATUS_CODE } from 'spooder';
import { format } from 'node:util';

const server = serve(Number(process.env.SERVER_PORT));

function log(prefix: string, message: string, ...args: unknown[]): void {
	let formatted_message = format('[{' + prefix + '}] ' + message, ...args);
	formatted_message = formatted_message.replace(/\{([^}]+)\}/g, '\x1b[38;5;13m$1\x1b[0m');

	console.log(formatted_message);
}

function default_handler(status_code: number): Response {
	return new Response(HTTP_STATUS_CODE[status_code] as string, { status: status_code });
}

// test route
server.route('/test', (req, url) => {
	log('dev', 'test route is {working}!');
	return 200;
});

// caution on slow requests
server.on_slow_request((req, request_time, url) => {
	caution(`Slow request: ${req.method} ${url.pathname}`, { request_time });
}, 500);

// unhandled exceptions and rejections
server.error((err: Error) => {
	caution(err?.message ?? err);
	return default_handler(500);
});

// unhandled response codes.
server.default((req, status_code) => default_handler(status_code));

// source control webhook
if (typeof process.env.GH_WEBHOOK_SECRET === 'string') {
	server.webhook(process.env.GH_WEBHOOK_SECRET, '/internal/webhook', () => {
		setImmediate(() => server.stop(false));
		return 200;
	});
} else {
	caution('GH_WEBHOOK_SECRET environment variable not configured');
}