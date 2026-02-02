// ------------------------
// EventLogger Bot
// ------------------------

// Load modules
const fs = require('fs');
const express = require('express');
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, 
    TextInputStyle, SlashCommandBuilder, PermissionsBitField, REST, Routes, MessageFlags 
} = require('discord.js');
require('dotenv').config(); // Load .env locally (ignored by Git)

// ------------------------
// CONFIGURATION
// ------------------------
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const BOT_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// In-memory store for pending submissions
const pendingSubmissions = new Map();

// In-memory counts (can persist to counts.json)
let counts = {};
try {
    counts = JSON.parse(fs.readFileSync('counts.json', 'utf8'));
} catch {
    counts = {};
}

// ------------------------
// BOT CLIENT SETUP
// ------------------------
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// ------------------------
// COMMAND DEFINITIONS
// ------------------------
const commands = [
    new SlashCommandBuilder()
        .setName('logevent')
        .setDescription('Submit a log for an event.')
        .addStringOption(option => 
            option.setName('eventtype')
                .setDescription('The type of event you are logging.')
                .setRequired(true)
                .setAutocomplete(true))
        .addAttachmentOption(option =>
            option.setName('proof')
                .setDescription('The image proof for the event.')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('setlogchannel')
        .setDescription('Sets the channel for event logs (Admin only).')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to send logs to.')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('addeventtype')
        .setDescription('Adds a new type to the event list (Admin only).')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('The new event type to add.')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('removeeventtype')
        .setDescription('Removes a type from the event list (Admin only).')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('The event type to remove.')
                .setRequired(true)
                .setAutocomplete(true))
].map(command => command.toJSON());

// ------------------------
// READY EVENT & COMMAND REGISTRATION
// ------------------------
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Register commands for a guild (fast)
    if (GUILD_ID) {
        const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
        try {
            console.log('Started refreshing application (/) commands.');
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
            console.log('Successfully reloaded application (/) commands.');
        } catch (error) {
            console.error(error);
        }
    }
});

// ------------------------
// INTERACTION HANDLING
// ------------------------
client.on('interactionCreate', async interaction => {
    // CHAT INPUT COMMANDS
    if (interaction.isChatInputCommand()) {

        // ----------------
        // logevent command
        // ----------------
        if (interaction.commandName === 'logevent') {
            const eventType = interaction.options.getString('eventtype');
            const attachment = interaction.options.getAttachment('proof');

            if (!attachment || !attachment.contentType.startsWith('image/')) {
                return interaction.reply({ content: 'Please attach a valid image file as proof.', flags: [MessageFlags.Ephemeral] });
            }

            pendingSubmissions.set(interaction.user.id, {
                proofUrl: attachment.url,
                eventType
            });

            // Modal
            const modal = new ModalBuilder()
                .setCustomId('eventLogModal')
                .setTitle('Event Log Submission');

            const hostInput = new TextInputBuilder()
                .setCustomId('hostUsername')
                .setLabel("What is the host's username?")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const timeInput = new TextInputBuilder()
                .setCustomId('eventTime')
                .setLabel('Event Time (e.g., 8:30 PM EST)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(hostInput),
                new ActionRowBuilder().addComponents(timeInput)
            );

            await interaction.showModal(modal);
        }

        // ----------------
        // Admin commands
        // ----------------
        if (interaction.commandName === 'setlogchannel') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
                return interaction.reply({ content: 'You do not have permission.', flags: [MessageFlags.Ephemeral] });
            const channel = interaction.options.getChannel('channel');
            config.logChannelId = channel.id;
            fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
            await interaction.reply({ content: `Log channel set to ${channel}`, flags: [MessageFlags.Ephemeral] });
        }

        if (interaction.commandName === 'addeventtype') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
                return interaction.reply({ content: 'You do not have permission.', flags: [MessageFlags.Ephemeral] });
            const newType = interaction.options.getString('type');
            if (config.eventTypes.includes(newType))
                return interaction.reply({ content: `'${newType}' already exists.`, flags: [MessageFlags.Ephemeral] });
            config.eventTypes.push(newType);
            fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
            await interaction.reply({ content: `'${newType}' added.`, flags: [MessageFlags.Ephemeral] });
        }

        if (interaction.commandName === 'removeeventtype') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
                return interaction.reply({ content: 'You do not have permission.', flags: [MessageFlags.Ephemeral] });
            const typeToRemove = interaction.options.getString('type');
            config.eventTypes = config.eventTypes.filter(t => t !== typeToRemove);
            fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
            await interaction.reply({ content: `'${typeToRemove}' removed.`, flags: [MessageFlags.Ephemeral] });
        }
    }

    // MODAL SUBMISSION
    if (interaction.isModalSubmit() && interaction.customId === 'eventLogModal') {
        const hostUsername = interaction.fields.getTextInputValue('hostUsername');
        const eventTime = interaction.fields.getTextInputValue('eventTime');

        const pendingData = pendingSubmissions.get(interaction.user.id);
        pendingSubmissions.delete(interaction.user.id);

        if (!pendingData)
            return interaction.reply({ content: 'Session data not found.', flags: [MessageFlags.Ephemeral] });

        const { proofUrl, eventType } = pendingData;

        const logChannel = await client.channels.fetch(config.logChannelId).catch(() => null);
        if (!logChannel)
            return interaction.reply({ content: 'Log channel not found.', flags: [MessageFlags.Ephemeral] });

        // Increment event count
        counts[interaction.user.id] = (counts[interaction.user.id] || 0) + 1;
        fs.writeFileSync('counts.json', JSON.stringify(counts, null, 2));

        const logEmbed = new EmbedBuilder()
            .setColor(0x00AE86)
            .setTitle('New Event Log Submitted')
            .addFields(
                { name: 'Submitted By', value: `${interaction.user} (${interaction.user.tag})`, inline: true },
                { name: 'Host', value: hostUsername, inline: true },
                { name: 'Event Type', value: eventType, inline: true },
                { name: 'Event Time', value: eventTime, inline: false },
                { name: 'Total Events Logged', value: `${counts[interaction.user.id]}`, inline: true }
            )
            .setImage(proofUrl)
            .setTimestamp()
            .setFooter({ text: `Event Logger` });

        await logChannel.send({ embeds: [logEmbed] });
        await interaction.reply({ content: 'Your event has been logged!', flags: [MessageFlags.Ephemeral] });
    }

    // AUTOCOMPLETE
    if (interaction.isAutocomplete() && (interaction.commandName === 'logevent' || interaction.commandName === 'removeeventtype')) {
        const focusedValue = interaction.options.getFocused();
        const filtered = config.eventTypes.filter(choice => choice.toLowerCase().startsWith(focusedValue.toLowerCase()));
        await interaction.respond(filtered.map(choice => ({ name: choice, value: choice })));
    }
});

// ------------------------
// EXPRESS PING SERVER (for free Render)
// ------------------------
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Ping server running.'));
app.listen(PORT, () => console.log(`Ping server running on port ${PORT}`));

// ------------------------
// LOGIN
// ------------------------
client.login(BOT_TOKEN);
