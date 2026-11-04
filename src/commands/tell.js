import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  MessageFlags,
} from 'discord.js';
import { isHarmfulReply } from '../safety.js';

// Her own words around theirs, so it's always clear who said what. {message} goes on a
// line of its own as a quote.
const toSomeone = [
  `Oi {target}, Nine {sender} wants me to tell you this:\n> {message}\nDon't shoot the messenger.`,
  `{target}. Message from Nine {sender}, and no, I didn't write it:\n> {message}`,
  `Ugh. {target}, Nine {sender} made me your mailman:\n> {message}\nI'm not waiting around for a reply.`,
  `Listen up, {target}. Nine {sender} says:\n> {message}\nTake it up with them, not me.`,
];

const toEveryone = [
  `Nine {sender} wants everyone to hear this:\n> {message}\nDon't look at me, I just work here.`,
  `Announcement from Nine {sender}, apparently:\n> {message}`,
  `Shut up for a sec. Nine {sender} has somethin' to say:\n> {message}`,
];

const toThemselves = `You want me to tell you what you just said, Nine {sender}? Fine:\n> {message}\nHappy now?`;

const pick = (lines) => lines[Math.floor(Math.random() * lines.length)];

export default {
  // Unlike /echo, this is a reply to the command, so it works anywhere the command does,
  // group DMs included, where she can't post on her own. That reply also shows who used
  // it, so anyone can.
  data: new SlashCommandBuilder()
    .setName('tell')
    .setDescription('Have her pass your message on. Works in group DMs too.')
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ])
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    ])
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('What she passes on')
        .setRequired(true)
        .setMaxLength(1500)
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Who it is for. Leave it out to tell everyone here.')
        .setRequired(false)
    ),

  async execute(interaction) {
    const sender = interaction.user;
    const target = interaction.options.getUser('user');
    const message = interaction.options.getString('message');

    if (isHarmfulReply(message)) {
      await interaction.reply({
        content: `Not passin' that along, Nine.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (target?.id === interaction.client.user.id) {
      await interaction.reply({
        content: `I heard you the first time, Nine. You don't gotta send it through me.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const template = !target
      ? pick(toEveryone)
      : target.id === sender.id
        ? toThemselves
        : pick(toSomeone);
    // Functions, so a "$&" in their message stays as typed.
    const content = template
      .replace('{target}', () => `${target}`)
      .replace('{sender}', () => `${sender}`)
      .replace('{message}', () => message);

    console.log(
      `💬 ${sender.username} (${sender.id}) used /tell${target ? ` for ${target.username}` : ''}: ${message.slice(0, 200)}`
    );

    // Only the person it's for gets pinged: nobody named in the message, and no @everyone.
    await interaction.reply({
      content,
      allowedMentions: { users: target && target.id !== sender.id ? [target.id] : [] },
    });
  },
};
