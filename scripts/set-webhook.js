// Points the Telegram bot at the Supabase edge function.
//   npm run webhook:set      npm run webhook:info
import { telegram } from '../lib/telegram.js';

if (process.argv.includes('--info')) {
  console.log(JSON.stringify(await telegram('getWebhookInfo', {}), null, 2));
  process.exit(0);
}

const REF = process.env.SUPABASE_PROJECT_REF;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!REF || !secret) {
  console.error('Set SUPABASE_PROJECT_REF and TELEGRAM_WEBHOOK_SECRET in .env');
  process.exit(1);
}

const url = `https://${REF}.supabase.co/functions/v1/telegram`;
await telegram('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'channel_post', 'callback_query'] });
await telegram('setMyCommands', {
  commands: [
    { command: 'drafts', description: 'List recent drafts' },
    { command: 'help', description: 'What this bot does' },
  ],
});
const info = await telegram('getWebhookInfo', {});
console.log(`Webhook set to ${info.url}`);
console.log(`Pending updates: ${info.pending_update_count}${info.last_error_message ? `, last error: ${info.last_error_message}` : ''}`);
