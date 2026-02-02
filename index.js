// --- IMPORTS ---
const fs = require('fs');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField, REST, Routes, MessageFlags, SlashCommandBuilder } = require('discord.js');
require('dotenv').config(); // load .env locally if needed

// --- CONFIG ---
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const countsFile = 'counts.json';
if (!fs.existsSync(countsFile)) fs.writeFileSync(countsFile, '{}');
const counts = JSON.parse(fs.readFileSync(countsFile, 'utf8'));

const BOT_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const pendingSubmissions = new Map();

// --- DISCORD CLIENT ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- COMMANDS ---
const commands = [
  new SlashCommandBuilder()
    .setName('logevent')
    .setDescription('Submit a log for an event.')
    .addStringOption(o => o.setName('eventtype').setDescription('Event type').setRequired(true).setAutocomplete(true))
    .addAttachmentOption(o => o.setName('proof').setDescription('Image proof').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setlogchannel')
    .setDescription('Set log channel (Admin)')
    .addChannelOption(o => o.setName('channel').setDescription('Channel to log events').setRequired(true)),

  new SlashCommandBuilder()
    .setName('addeventtype')
    .setDescription('Add new event type (Admin)')
    .addStringOption(o => o.setName('type').setDescription('Event type').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removeeventtype')
    .setDescription('Remove event type (Admin)')
    .addStringOption(o => o.setName('type').setDescription('Event type').setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Check your total submitted events')
].map(c => c.toJSON());

// --- EVENTS ---
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

  // Register slash commands
  if (GUILD_ID) {
    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    try {
      console.log('Refreshing commands...');
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log('Commands refreshed.');
    } catch (err) { console.error(err); }
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {

    // --- LOG EVENT ---
    if (interaction.commandName === 'logevent') {
      const eventType = interaction.options.getString('eventtype');
      const attachment = interaction.options.getAttachment('proof');

      if (!attachment || !attachment.contentType.startsWith('image/')) {
        return interaction.reply({ content: 'Attach a valid image!', flags: [MessageFlags.Ephemeral] });
      }

      pendingSubmissions.set(interaction.user.id, { proofUrl: attachment.url, eventType });

      const modal = new ModalBuilder()
        .setCustomId('eventLogModal')
        .setTitle('Event Log Submission');

      const hostInput = new TextInputBuilder()
        .setCustomId('hostUsername')
        .setLabel("Host's Username")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const timeInput = new TextInputBuilder()
        .setCustomId('eventTime')
        .setLabel('Event Time')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(hostInput),
        new ActionRowBuilder().addComponents(timeInput)
      );

      await interaction.showModal(modal);
    }

    // --- ADMIN COMMANDS ---
    if (['setlogchannel', 'addeventtype', 'removeeventtype'].includes(interaction.commandName)) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return interaction.reply({ content: 'No permission!', flags: [MessageFlags.Ephemeral] });
    }

    if (interaction.commandName === 'setlogchannel') {
      const channel = interaction.options.getChannel('channel');
      config.logChannelId = channel.id;
      fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
      return interaction.reply({ content: `Log channel set to ${channel}`, flags: [MessageFlags.Ephemeral] });
    }

    if (interaction.commandName === 'addeventtype') {
      const newType = interaction.options.getString('type');
      if (config.eventTypes.includes(newType)) return interaction.reply({ content: `'${newType}' already exists!`, flags: [MessageFlags.Ephemeral] });
      config.eventTypes.push(newType);
      fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
      return interaction.reply({ content: `Added event type '${newType}'`, flags: [MessageFlags.Ephemeral] });
    }

    if (interaction.commandName === 'removeeventtype') {
      const typeToRemove = interaction.options.getString('type');
      config.eventTypes = config.eventTypes.filter(t => t !== typeToRemove);
      fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
      return interaction.reply({ content: `Removed event type '${typeToRemove}'`, flags: [MessageFlags.Ephemeral] });
    }

    // --- STATS COMMAND ---
    if (interaction.commandName === 'stats') {
      const userCount = counts[interaction.user.id] || 0;
      return interaction.reply({ content: `You have submitted **${userCount}** events.`, flags: [MessageFlags.Ephemeral] });
    }
  }

  // --- MODAL SUBMISSIONS ---
  if (interaction.isModalSubmit() && interaction.customId === 'eventLogModal') {
    const hostUsername = interaction.fields.getTextInputValue('hostUsername');
    const eventTime = interaction.fields.getTextInputValue('eventTime');
    const pending = pendingSubmissions.get(interaction.user.id);
    pendingSubmissions.delete(interaction.user.id);

    if (!pending) return interaction.reply({ content: 'Session error!', flags: [MessageFlags.Ephemeral] });

    const { proofUrl, eventType } = pending;

    // Update counts.json
    counts[interaction.user.id] = (counts[interaction.user.id] || 0) + 1;
    fs.writeFileSync(countsFile, JSON.stringify(counts, null, 2));

    // Send embed to log channel
    const logChannel = await client.channels.fetch(config.logChannelId).catch(() => null);
    if (!logChannel) return interaction.reply({ content: 'Log channel missing!', flags: [MessageFlags.Ephemeral] });

    const embed = new EmbedBuilder()
      .setColor(0x00AE86)
      .setTitle('New Event Log Submitted')
      .addFields(
        { name: 'Submitted By', value: `${interaction.user} (${interaction.user.tag})`, inline: true },
        { name: "Host's Username", value: hostUsername, inline: true },
        { name: 'Event Type', value: eventType, inline: true },
        { name: 'Event Time', value: eventTime }
      )
      .setImage(proofUrl)
      .setTimestamp()
      .setFooter({ text: 'Event Logger' });

    await logChannel.send({ embeds: [embed] });
    return interaction.reply({ content: 'Event logged successfully!', flags: [MessageFlags.Ephemeral] });
  }

  // --- AUTOCOMPLETE ---
  if (interaction.isAutocomplete() && ['logevent', 'removeeventtype'].includes(interaction.commandName)) {
    const focused = interaction.options.getFocused();
    const filtered = config.eventTypes.filter(t => t.toLowerCase().startsWith(focused.toLowerCase()));
    return interaction.respond(filtered.map(t => ({ name: t, value: t })));
  }
});

// --- LOGIN BOT ---
client.login(BOT_TOKEN);

// --- EXPRESS PING SERVER FOR RENDER FREE ---
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (_, res) => res.send('Bot is running!'));
app.listen(PORT, () => console.log(`Ping server running on port ${PORT}`));
