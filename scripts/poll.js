// One polling pass: fetch new Telegram updates, handle each, and confirm it so it isn't seen again.
// Run by .github/workflows/poll.yml on a timer; also works locally with `npm run poll`.
import { telegram } from '../lib/telegram.js';
import { handleUpdate, RetryLater } from '../lib/bot.js';

const ALLOWED_UPDATES = ['message', 'channel_post'];

// getUpdates only works when no webhook is registered.
const info = await telegram('getWebhookInfo', {});
if (info.url) await telegram('deleteWebhook', {});

const updates = await telegram('getUpdates', { timeout: 0, allowed_updates: ALLOWED_UPDATES });
console.log(`${updates.length} new update(s)`);

let failed = 0;
for (const update of updates) {
  try {
    console.log(`update ${update.update_id}: ${(await handleUpdate(update)) ?? 'handled'}`);
  } catch (err) {
    if (err instanceof RetryLater) {
      // Leave this and later updates unconfirmed; the next run picks them up in order.
      console.log(`update ${update.update_id}: Gemini unavailable (${err.message.slice(0, 120)}), will retry next run`);
      break;
    }
    failed++;
    console.error(`update ${update.update_id} failed:`, err);
  }
  // Confirm after each one, so a crash later in the run doesn't cause duplicate drafts next time.
  await telegram('getUpdates', { offset: update.update_id + 1, limit: 1, timeout: 0, allowed_updates: ALLOWED_UPDATES });
}

if (failed) process.exitCode = 1;
