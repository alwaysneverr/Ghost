/**
 * Reminders that survive a restart. Each one stays in data/ghost.db until it's been
 * delivered, and any still waiting get their timers back when the bot starts.
 *
 * These go out as ordinary messages, not interaction follow-ups: Discord's interaction
 * tokens die after 15 minutes, and don't outlive a restart in any useful way.
 */

import { addReminder, countReminders, deleteReminder, getReminders } from './store.js';

const MESSAGE_LIMIT = 2000;
const MAX_REMINDERS_PER_PERSON = 20;
const LATE_AFTER_MS = 60 * 1000;
const RETRY_AFTER_MS = 5 * 60 * 1000;
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

function reminderText({ userId, reason, minutes, dueAt }, now = Date.now()) {
  const user = `<@${userId}>`;
  const rants = [
    `Oi, Nine ${user}! Get your lazy ass up and do this already: **${reason}**. I had to stare at the clock for ${minutes} minutes just for this!`,
    `Hey ${user}! Wake up! You forced me to remind you about: **${reason}**. Don't make me scream next time.`,
    `Mission accomplished. Here is your stupid reminder, ${user}: **${reason}**. Now stop bothering me for a while.`,
  ];
  const rant = rants[Math.floor(Math.random() * rants.length)];
  const lateBy = now - dueAt;
  const late =
    lateBy >= LATE_AFTER_MS
      ? `\n(I was out cold, so this is ${Math.round(lateBy / 60000)} minute(s) late. Not my fault.)`
      : '';
  return `${rant}${late}`.slice(0, MESSAGE_LIMIT);
}

// Back where they asked, or by DM if she can't reach that channel: /remind also works
// through a user install, in places the bot isn't. Only they get pinged, whatever the
// reason says, since people control that text.
async function send(client, reminder) {
  const message = {
    content: reminderText(reminder),
    allowedMentions: { users: [reminder.userId] },
  };
  try {
    const channel = await client.channels.fetch(reminder.channelId);
    await channel.send(message);
  } catch {
    const user = await client.users.fetch(reminder.userId);
    await user.send(message);
  }
}

// Stays stored until it's sent, so a crash at the wrong moment means a repeat at worst.
// One that's already a day overdue gets one try, then it's dropped.
async function deliver(client, reminder) {
  try {
    await send(client, reminder);
    deleteReminder(reminder.id);
  } catch (error) {
    if (Date.now() - reminder.dueAt >= GIVE_UP_AFTER_MS) {
      console.warn(`⚠️  Dropping reminder ${reminder.id}, which can't be delivered:`, error.message);
      deleteReminder(reminder.id);
      return;
    }
    console.warn(`⚠️  Could not deliver reminder ${reminder.id}, trying again later:`, error.message);
    setTimeout(() => deliver(client, reminder), RETRY_AFTER_MS);
  }
}

function schedule(client, reminder) {
  setTimeout(() => deliver(client, reminder), Math.max(0, reminder.dueAt - Date.now()));
}

// Returns false if they've got too many waiting already: each one sits on disk.
export function createReminder(client, { userId, channelId, reason, minutes }) {
  if (countReminders(userId) >= MAX_REMINDERS_PER_PERSON) return false;
  const dueAt = Date.now() + minutes * 60 * 1000;
  schedule(client, addReminder({ userId, channelId, reason, minutes, dueAt }));
  return true;
}

// Once, when the bot starts. Any that came due while it was off go out straight away.
export function restoreReminders(client) {
  try {
    const reminders = getReminders();
    for (const reminder of reminders) schedule(client, reminder);
    if (reminders.length > 0) console.log(`⏰ Restored ${reminders.length} reminder(s).`);
  } catch (error) {
    console.warn('⚠️  Could not restore reminders:', error.message);
  }
}
