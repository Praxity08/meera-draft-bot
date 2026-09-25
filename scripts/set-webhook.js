// Points the Telegram bot at the deployed Vercel endpoint.
//   npm run webhook:set -- https://your-app.vercel.app      npm run webhook:info
import { telegram } from '../lib/telegram.js';

if (process.argv.includes('--info')) {
  const info = await telegram('getWebhookInfo', {});
  console.log(JSON.stringify(info, null, 2));
  process.exit(0);
}

const base = process.argv[2];
if (!base?.startsWith('https://')) {
  console.error('Usage: npm run webhook:set -- https://<deployment>.vercel.app');
  process.exit(1);
}
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!secret) {
  console.error('TELEGRAM_WEBHOOK_SECRET is not set in .env');
  process.exit(1);
}

const url = `${base.replace(/\/$/, '')}/api/telegram`;
await telegram('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'channel_post'], drop_pending_updates: true });
await telegram('setMyCommands', {
  commands: [
    { command: 'drafts', description: 'List recent drafts' },
    { command: 'help', description: 'What this bot does' },
  ],
});
const info = await telegram('getWebhookInfo', {});
console.log(`Webhook set to ${info.url}`);
console.log(`Pending updates: ${info.pending_update_count}${info.last_error_message ? `, last error: ${info.last_error_message}` : ''}`);
