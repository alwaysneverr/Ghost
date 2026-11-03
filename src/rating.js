/**
 * 👍/👎 buttons under her replies. They replace reactions, which need her to be in the
 * channel, so they didn't work in group DMs or anywhere she's only there through a
 * command. Each person's latest vote is the one that counts (scripts/lib/ratings.js),
 * and votes go to the same log as reactions did.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { logRating } from './logger.js';

const PREFIX = 'rate:';

export function ratingButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}up`).setEmoji('👍').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}down`).setEmoji('👎').setStyle(ButtonStyle.Secondary)
  );
}

export function isRatingButton(interaction) {
  return interaction.isButton() && interaction.customId.startsWith(PREFIX);
}

// Only the person who pressed it sees the answer.
export async function handleRatingButton(interaction) {
  const rating = interaction.customId === `${PREFIX}up` ? 'up' : 'down';
  logRating({ messageId: interaction.message.id, rating, raterId: interaction.user.id });
  await interaction.reply({
    content: rating === 'up' ? 'Heh. Noted.' : 'Tch. Noted.',
    flags: MessageFlags.Ephemeral,
  });
}
