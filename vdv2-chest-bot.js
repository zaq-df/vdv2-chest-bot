require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Client,
    EmbedBuilder,
    Events,
    GatewayIntentBits,
    PermissionFlagsBits,
    SlashCommandBuilder,
} = require('discord.js');

const DEFAULT_CHEST_IMAGE_PATH = path.join(__dirname, 'assets', 'vdv2chest.png');
const CHEST_IMAGE_ATTACHMENT_NAME = 'vdv2chest.png';

const CONFIG = {
    token: process.env.DISCORD_TOKEN || process.env.BOT_TOKEN,
    guildId: process.env.GUILD_ID,
    chestChannelId: process.env.CHEST_CHANNEL_ID,
    dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
    maxOpens: readInt('CHEST_MAX_OPENS', 5),
    coinMin: readInt('CHEST_COIN_MIN', 1),
    coinMax: readInt('CHEST_COIN_MAX', 6),
    timeoutMinutes: readInt('CHEST_TIMEOUT_MINUTES', 5),
    autoMinutes: readInt('CHEST_AUTO_MINUTES', 120),
    spawnOnStart: readBool('SPAWN_CHEST_ON_START', false),
    chestImageUrl: process.env.CHEST_IMAGE_URL || '',
    chestImagePath: resolveProjectPath(process.env.CHEST_IMAGE_PATH || DEFAULT_CHEST_IMAGE_PATH),
    vdv2TagRoleId: process.env.VDV2_TAG_ROLE_ID || '',
    boosterRoleId: process.env.BOOSTER_ROLE_ID || '',
    coinEmoji: process.env.COIN_EMOJI || '🪙',
};

const COLORS = {
    chest: 0x5865f2,
    result: 0xf2b233,
};

const DATA_FILE = path.join(CONFIG.dataDir, 'vdv2-chest-data.json');
const data = loadData();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});
let autoChestTimer = null;

client.once(Events.ClientReady, async () => {
    console.log(`VDV2 Chest Bot is online as ${client.user.tag}`);
    console.log(`VDV2 data file: ${DATA_FILE}`);
    console.log(`VDV2 balances loaded: ${countBalances()}`);

    if (process.env.RAILWAY_ENVIRONMENT && CONFIG.dataDir !== '/data') {
        console.warn(`DATA_DIR is "${CONFIG.dataDir}". Use DATA_DIR=/data with a Railway Volume to keep the leaderboard after deploys.`);
    }

    await registerCommands().catch((error) => {
        console.error('Could not register commands:', error);
    });

    if (CONFIG.spawnOnStart) {
        await spawnChestInConfiguredChannel('startup').catch((error) => {
            console.error('Could not spawn startup VDV2 chest:', error);
        });
    }

    scheduleAutoChest('startup');
});

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            await handleCommand(interaction);
            return;
        }

        if (interaction.isButton()) {
            await handleButton(interaction);
        }
    } catch (error) {
        console.error('Interaction error:', error);
        await safeInteractionReply(interaction, {
            content: 'Something went wrong while handling this action.',
            ephemeral: true,
        });
    }
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (!CONFIG.token) {
    console.error('Missing DISCORD_TOKEN. Add it in Railway Variables or in a local .env file.');
    process.exit(1);
}

client.login(CONFIG.token);

async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('spawnchest')
            .setDescription('Spawn a VDV2 chest.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addChannelOption((option) =>
                option
                    .setName('channel')
                    .setDescription('Channel where the VDV2 chest should appear.')
                    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                    .setRequired(false)
            ),
        new SlashCommandBuilder()
            .setName('coins')
            .setDescription('Check your VDV2 Coins or another member VDV2 Coins.')
            .addUserOption((option) =>
                option
                    .setName('user')
                    .setDescription('Member to check.')
                    .setRequired(false)
            ),
        new SlashCommandBuilder()
            .setName('mycoins')
            .setDescription('See your own VDV2 Coins.'),
        new SlashCommandBuilder()
            .setName('leaderboard')
            .setDescription('Show the saved VDV2 Coins leaderboard.'),
        new SlashCommandBuilder()
            .setName('addcoins')
            .setDescription('Add VDV2 Coins to a member.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addUserOption((option) =>
                option
                    .setName('user')
                    .setDescription('Member receiving VDV2 Coins.')
                    .setRequired(true)
            )
            .addIntegerOption((option) =>
                option
                    .setName('amount')
                    .setDescription('Amount to add.')
                    .setMinValue(1)
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('removecoins')
            .setDescription('Remove VDV2 Coins from a member.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addUserOption((option) =>
                option
                    .setName('user')
                    .setDescription('Member losing VDV2 Coins.')
                    .setRequired(true)
            )
            .addIntegerOption((option) =>
                option
                    .setName('amount')
                    .setDescription('Amount to remove.')
                    .setMinValue(1)
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('setcoins')
            .setDescription('Set the exact VDV2 Coins balance for a member.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addUserOption((option) =>
                option
                    .setName('user')
                    .setDescription('Member to edit.')
                    .setRequired(true)
            )
            .addIntegerOption((option) =>
                option
                    .setName('amount')
                    .setDescription('New VDV2 Coins balance.')
                    .setMinValue(0)
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('setchestchannel')
            .setDescription('Set the channel where automatic VDV2 chests are sent.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addChannelOption((option) =>
                option
                    .setName('channel')
                    .setDescription('Channel for VDV2 chests.')
                    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('setchesttimer')
            .setDescription('Set automatic VDV2 chest interval in minutes.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addIntegerOption((option) =>
                option
                    .setName('minutes')
                    .setDescription('Minutes between automatic VDV2 chests. Use 0 to disable.')
                    .setMinValue(0)
                    .setMaxValue(10080)
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('exportcoins')
            .setDescription('Export a VDV2 Coins backup file.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
        new SlashCommandBuilder()
            .setName('restorecoins')
            .setDescription('Restore VDV2 Coins from an exported backup file.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addAttachmentOption((option) =>
                option
                    .setName('file')
                    .setDescription('Backup JSON from /exportcoins.')
                    .setRequired(true)
            )
            .addStringOption((option) =>
                option
                    .setName('mode')
                    .setDescription('Replace all balances or merge with current balances.')
                    .addChoices(
                        { name: 'replace', value: 'replace' },
                        { name: 'merge', value: 'merge' }
                    )
                    .setRequired(false)
            ),
        new SlashCommandBuilder()
            .setName('rebuildcoins')
            .setDescription('Rebuild VDV2 Coins by scanning old chest summary messages.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addChannelOption((option) =>
                option
                    .setName('channel')
                    .setDescription('Channel that contains the old VDV2 chest messages.')
                    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                    .setRequired(true)
            )
            .addIntegerOption((option) =>
                option
                    .setName('limit')
                    .setDescription('How many recent messages to scan. Default 1000.')
                    .setMinValue(100)
                    .setMaxValue(5000)
                    .setRequired(false)
            )
            .addStringOption((option) =>
                option
                    .setName('mode')
                    .setDescription('Replace all balances or add recovered coins over current balances.')
                    .addChoices(
                        { name: 'replace', value: 'replace' },
                        { name: 'merge', value: 'merge' }
                    )
                    .setRequired(false)
            ),
    ].map((command) => command.toJSON());

    if (CONFIG.guildId) {
        const guild = await client.guilds.fetch(CONFIG.guildId);
        await guild.commands.set(commands);
        console.log(`Registered ${commands.length} guild commands for ${guild.name}`);
        return;
    }

    await client.application.commands.set(commands);
    console.log(`Registered ${commands.length} global commands`);
}

async function handleCommand(interaction) {
    if (interaction.commandName === 'spawnchest') {
        await handleSpawnChestCommand(interaction);
        return;
    }

    if (interaction.commandName === 'coins') {
        const user = interaction.options.getUser('user') || interaction.user;
        const balance = getCoins(user.id);
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(COLORS.result)
                    .setDescription(`${userMention(user.id)} has **${balance} VDV2 Coins**.`),
            ],
            ephemeral: true,
        });
        return;
    }

    if (interaction.commandName === 'mycoins') {
        await handleMyCoinsCommand(interaction);
        return;
    }

    if (interaction.commandName === 'leaderboard') {
        await handleLeaderboardCommand(interaction);
        return;
    }

    if (interaction.commandName === 'addcoins' || interaction.commandName === 'removecoins') {
        await handleCoinAdminCommand(interaction);
        return;
    }

    if (interaction.commandName === 'setcoins') {
        await handleSetCoinsCommand(interaction);
        return;
    }

    if (interaction.commandName === 'setchestchannel') {
        await handleSetChestChannelCommand(interaction);
        return;
    }

    if (interaction.commandName === 'setchesttimer') {
        await handleSetChestTimerCommand(interaction);
        return;
    }

    if (interaction.commandName === 'exportcoins') {
        await handleExportCoinsCommand(interaction);
        return;
    }

    if (interaction.commandName === 'restorecoins') {
        await handleRestoreCoinsCommand(interaction);
        return;
    }

    if (interaction.commandName === 'rebuildcoins') {
        await handleRebuildCoinsCommand(interaction);
    }
}

async function handleSpawnChestCommand(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
            content: 'You need Manage Server permission to spawn chests.',
            ephemeral: true,
        });
        return;
    }

    const channel =
        interaction.options.getChannel('channel') ||
        (getChestChannelId() ? await client.channels.fetch(getChestChannelId()) : interaction.channel);

    if (!channel?.isTextBased?.()) {
        await interaction.reply({
            content: 'I need a text channel where I can send the VDV2 chest.',
            ephemeral: true,
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });
    const message = await createChestMessage(channel);

    await interaction.editReply({
        content: `VDV2 chest spawned in ${channelMention(channel.id)}: ${message.url}`,
    });
}

async function handleMyCoinsCommand(interaction) {
    const balance = getCoins(interaction.user.id);

    await interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setColor(COLORS.result)
                .setTitle('Your VDV2 Coins')
                .setDescription(`${userMention(interaction.user.id)}, you have **${balance} VDV2 Coins**.`),
        ],
        ephemeral: true,
    });
}

async function handleLeaderboardCommand(interaction) {
    const top = Object.entries(data.coins)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const description = top.length
        ? top.map(([userId, coins], index) => `**${index + 1}.** ${userMention(userId)} - **${coins} VDV2 Coins**`).join('\n')
        : 'No VDV2 Coins collected yet.';

    await interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setColor(COLORS.result)
                .setTitle('VDV2 Coins Leaderboard')
                .setDescription(description),
        ],
    });
}

async function handleCoinAdminCommand(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
            content: 'You need Manage Server permission to edit VDV2 Coins.',
            ephemeral: true,
        });
        return;
    }

    const user = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    const multiplier = interaction.commandName === 'addcoins' ? 1 : -1;
    const nextBalance = addCoins(user.id, amount * multiplier);
    saveData();

    await interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setColor(COLORS.result)
                .setDescription(`${userMention(user.id)} now has **${nextBalance} VDV2 Coins**.`),
        ],
        ephemeral: true,
    });
}

async function handleSetCoinsCommand(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
            content: 'You need Manage Server permission to edit VDV2 Coins.',
            ephemeral: true,
        });
        return;
    }

    const user = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    data.coins[user.id] = amount;
    saveData();

    await interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setColor(COLORS.result)
                .setDescription(`${userMention(user.id)} now has exactly **${amount} VDV2 Coins**.`),
        ],
        ephemeral: true,
    });
}

async function handleSetChestChannelCommand(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
            content: 'You need Manage Server permission to set the VDV2 chest channel.',
            ephemeral: true,
        });
        return;
    }

    const channel = interaction.options.getChannel('channel', true);

    if (!channel?.isTextBased?.()) {
        await interaction.reply({
            content: 'Choose a text channel for VDV2 chests.',
            ephemeral: true,
        });
        return;
    }

    data.settings.chestChannelId = channel.id;
    saveData();

    await interaction.reply({
        content: `VDV2 chest channel saved: ${channelMention(channel.id)}. Automatic chests will be sent there every ${getAutoMinutes()} minutes.`,
        ephemeral: true,
    });
}

async function handleSetChestTimerCommand(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
            content: 'You need Manage Server permission to set the VDV2 chest timer.',
            ephemeral: true,
        });
        return;
    }

    const minutes = interaction.options.getInteger('minutes', true);
    data.settings.autoMinutes = minutes;
    saveData();
    scheduleAutoChest('command');

    await interaction.reply({
        content: minutes > 0
            ? `VDV2 automatic chest timer set to **${minutes} minutes**. The next automatic chest will be sent after this new interval.`
            : 'VDV2 automatic chest timer disabled.',
        ephemeral: true,
    });
}

async function handleExportCoinsCommand(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
            content: 'You need Manage Server permission to export VDV2 Coins.',
            ephemeral: true,
        });
        return;
    }

    const backup = {
        exportedAt: new Date().toISOString(),
        dataFile: DATA_FILE,
        coins: data.coins,
        settings: data.settings,
    };
    const json = JSON.stringify(backup, null, 2);

    await interaction.reply({
        content: `VDV2 Coins backup created. Balances: **${countBalances()}**.`,
        files: [
            {
                attachment: Buffer.from(json, 'utf8'),
                name: `vdv2-coins-backup-${Date.now()}.json`,
            },
        ],
        ephemeral: true,
    });
}

async function handleRestoreCoinsCommand(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
            content: 'You need Manage Server permission to restore VDV2 Coins.',
            ephemeral: true,
        });
        return;
    }

    const attachment = interaction.options.getAttachment('file', true);
    const mode = interaction.options.getString('mode') || 'replace';

    await interaction.deferReply({ ephemeral: true });

    const backup = await fetchJsonAttachment(attachment);
    const restoredCoins = normalizeCoins(backup.coins || backup);

    if (!Object.keys(restoredCoins).length) {
        await interaction.editReply('That backup does not contain any VDV2 Coins.');
        return;
    }

    if (mode === 'merge') {
        data.coins = {
            ...data.coins,
            ...restoredCoins,
        };
    } else {
        data.coins = restoredCoins;
    }

    if (backup.settings && typeof backup.settings === 'object') {
        data.settings = {
            ...data.settings,
            ...backup.settings,
        };
    }

    saveData();
    scheduleAutoChest('restore');

    await interaction.editReply(`VDV2 Coins restored in **${mode}** mode. Balances now saved: **${countBalances()}**.`);
}

async function handleRebuildCoinsCommand(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
            content: 'You need Manage Server permission to rebuild VDV2 Coins.',
            ephemeral: true,
        });
        return;
    }

    const channel = interaction.options.getChannel('channel', true);
    const limit = interaction.options.getInteger('limit') || 1000;
    const mode = interaction.options.getString('mode') || 'replace';

    if (!channel?.isTextBased?.()) {
        await interaction.reply({
            content: 'Choose a text channel that contains old VDV2 chest messages.',
            ephemeral: true,
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const messages = await fetchRecentMessages(channel, limit);
    const recovered = rebuildCoinsFromMessages(messages);
    const recoveredCount = Object.keys(recovered.coins).length;

    if (!recoveredCount) {
        await interaction.editReply(
            `I scanned **${messages.length}** messages in ${channelMention(channel.id)}, but I could not find any chest summary coin lines. Try a higher limit or the channel where the chest results were posted.`
        );
        return;
    }

    if (mode === 'merge') {
        for (const [userId, amount] of Object.entries(recovered.coins)) {
            addCoins(userId, amount);
        }
    } else {
        data.coins = recovered.coins;
    }

    saveData();

    await interaction.editReply(
        [
            `Rebuilt VDV2 Coins from ${channelMention(channel.id)}.`,
            `Scanned messages: **${messages.length}**`,
            `Chest summaries found: **${recovered.summaryCount}**`,
            `Members recovered: **${recoveredCount}**`,
            `Mode: **${mode}**`,
            '',
            'Run `/leaderboard` to check the recovered top.',
        ].join('\n')
    );
}

async function handleButton(interaction) {
    const [namespace, action, chestId] = interaction.customId.split(':');

    if (namespace !== 'chest' || !chestId) {
        return;
    }

    const chest = data.chests[chestId];

    if (!chest) {
        await interaction.reply({
            content: 'This chest is no longer active.',
            ephemeral: true,
        });
        return;
    }

    if (action === 'help') {
        await interaction.reply({
            embeds: [buildHelpEmbed()],
            ephemeral: true,
        });
        return;
    }

    if (action !== 'open') {
        return;
    }

    if (chest.closed) {
        await interaction.reply({
            content: 'This VDV2 chest is already closed.',
            ephemeral: true,
        });
        return;
    }

    if (chest.openedBy[interaction.user.id]) {
        await interaction.reply({
            content: 'You already opened this VDV2 chest.',
            ephemeral: true,
        });
        return;
    }

    const userId = interaction.user.id;

    chest.openedBy[userId] = {
        userId,
        result: 'opening...',
        coins: 0,
        trapped: false,
        openedAt: new Date().toISOString(),
    };

    if (openedCount(chest) >= chest.maxOpens) {
        chest.closed = true;
        chest.closedAt = new Date().toISOString();
    }

    saveData();

    try {
        await interaction.deferReply();

        const member = await getGuildMember(interaction);
        const outcome = chooseOutcome(member);
        const result = await applyOutcome(interaction, member, outcome);

        chest.openedBy[userId] = {
            userId,
            result: result.summary,
            coins: result.coins,
            trapped: result.trapped,
            openedAt: new Date().toISOString(),
        };

        saveData();

        await interaction.editReply({
            embeds: [buildResultEmbed(userId, result)],
        });

        await updateChestMessage(interaction, chest);

        if (chest.closed) {
            await interaction.followUp({
                embeds: [buildFinalEmbed(chest)],
            });
        }
    } catch (error) {
        delete chest.openedBy[userId];

        if (openedCount(chest) < chest.maxOpens) {
            chest.closed = false;
            delete chest.closedAt;
        }

        saveData();
        throw error;
    }
}

async function createChestMessage(channel) {
    const chest = createChest(channel.guildId, channel.id);
    const payload = buildChestPayload(chest, { includeFiles: true });
    const message = await channel.send(payload);

    chest.messageId = message.id;
    data.chests[chest.id] = chest;
    saveData();

    return message;
}

async function spawnChestInConfiguredChannel(reason) {
    const channelId = getChestChannelId();

    if (!channelId) {
        console.log(`Skipping ${reason} VDV2 chest spawn because no chest channel is set.`);
        return;
    }

    const channel = await client.channels.fetch(channelId);

    if (!channel?.isTextBased?.()) {
        throw new Error('The saved VDV2 chest channel is not a text channel.');
    }

    const message = await createChestMessage(channel);
    console.log(`Spawned ${reason} VDV2 chest: ${message.url}`);
}

function scheduleAutoChest(reason) {
    if (autoChestTimer) {
        clearInterval(autoChestTimer);
        autoChestTimer = null;
    }

    const minutes = getAutoMinutes();

    if (minutes <= 0) {
        console.log(`Automatic VDV2 chest timer disabled by ${reason}.`);
        return;
    }

    autoChestTimer = setInterval(() => {
        spawnChestInConfiguredChannel('timer').catch((error) => {
            console.error('Could not spawn automatic VDV2 chest:', error);
        });
    }, minutes * 60 * 1000);

    console.log(`Automatic VDV2 chest timer set to ${minutes} minutes by ${reason}.`);
}

function createChest(guildId, channelId) {
    return {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        guildId,
        channelId,
        messageId: '',
        maxOpens: CONFIG.maxOpens,
        openedBy: {},
        closed: false,
        createdAt: new Date().toISOString(),
    };
}

function buildChestPayload(chest, options = {}) {
    const payload = {
        embeds: [buildChestEmbed(chest)],
        components: [buildChestButtons(chest)],
    };

    const imageFile = getChestImageFile();

    if (options.includeFiles && imageFile) {
        payload.files = [imageFile];
    }

    return payload;
}

function buildChestEmbed(chest) {
    const embed = new EmbedBuilder()
        .setColor(COLORS.chest)
        .setTitle('A mysterious VDV2 chest has appeared!')
        .setDescription(
            [
                '**VDV2 Treasure or Trouble?**',
                'Surprise! A VDV2 mystery chest has appeared.',
                '',
                '**Could be VDV2 Coins... could be trouble.**',
                'Only one way to find out.',
            ].join('\n')
        )
        .addFields(
            {
                name: 'VDV2 Tag',
                value: CONFIG.vdv2TagRoleId ? `${roleMention(CONFIG.vdv2TagRoleId)}: higher chance of finding VDV2 Coins` : 'Higher chance of finding VDV2 Coins',
                inline: true,
            },
            {
                name: 'Server Boosters',
                value: 'Immune to timeouts',
                inline: true,
            }
        )
        .setFooter({ text: `${openedCount(chest)}/${chest.maxOpens} opened - VDV2 chest ${chest.closed ? 'closed' : 'open'}` });

    if (CONFIG.chestImageUrl) {
        embed.setImage(CONFIG.chestImageUrl);
    } else if (getChestImageFile()) {
        embed.setImage(`attachment://${CHEST_IMAGE_ATTACHMENT_NAME}`);
    }

    return embed;
}

function buildChestButtons(chest) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`chest:open:${chest.id}`)
            .setLabel('Open VDV2 Chest')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(chest.closed),
        new ButtonBuilder()
            .setCustomId(`chest:help:${chest.id}`)
            .setLabel('How does VDV2 work?')
            .setEmoji('❓')
            .setStyle(ButtonStyle.Secondary)
    );
}

function buildHelpEmbed() {
    return new EmbedBuilder()
        .setColor(COLORS.chest)
        .setTitle('How does VDV2 work?')
        .setDescription(
            [
                `Each member can open a VDV2 chest once. A VDV2 chest closes after **${CONFIG.maxOpens}** opens.`,
                `You can find **${CONFIG.coinMin}-${CONFIG.coinMax} VDV2 Coins**, find nothing, or trigger a trap.`,
                `Traps timeout members for **${CONFIG.timeoutMinutes} minutes**. Server Boosters are immune.`,
                CONFIG.vdv2TagRoleId ? `${roleMention(CONFIG.vdv2TagRoleId)} members have a higher chance to find VDV2 Coins.` : 'Set VDV2_TAG_ROLE_ID to give one role better odds.',
            ].join('\n')
        );
}

function buildResultEmbed(userId, result) {
    return new EmbedBuilder()
        .setColor(COLORS.result)
        .setDescription(
            [
                `${userMention(userId)} ${CONFIG.coinEmoji} **VDV2 Coins!**`,
                result.message,
                'You can redeem your VDV2 Coins via a ticket.',
            ].join('\n')
        );
}

function buildFinalEmbed(chest) {
    const entries = Object.values(chest.openedBy);
    const lines = entries.map((entry) => `${CONFIG.coinEmoji} ${userMention(entry.userId)} - ${entry.result}`);
    const plural = entries.length === 1 ? 'member' : 'members';

    return new EmbedBuilder()
        .setColor(COLORS.result)
        .setTitle('The VDV2 chest has been fully looted!')
        .setDescription([...lines, '', `**${entries.length} ${plural} opened this VDV2 chest**`].join('\n'));
}

async function applyOutcome(interaction, member, outcome) {
    if (outcome === 'coins') {
        const coins = randomInt(CONFIG.coinMin, CONFIG.coinMax);
        addCoins(interaction.user.id, coins);

        return {
            coins,
            trapped: false,
            summary: `${coins} VDV2 ${coins === 1 ? 'Coin' : 'Coins'}`,
            message: `You found **${coins}**.`,
        };
    }

    if (outcome === 'empty') {
        return {
            coins: 0,
            trapped: false,
            summary: 'nothing',
            message: 'The VDV2 chest was empty. Better luck next time!',
        };
    }

    const immune = isBooster(member);

    if (immune) {
        return {
            coins: 0,
            trapped: true,
            summary: 'trap blocked (booster)',
            message: 'Trouble! The VDV2 chest was trapped, but your booster perks protected you from the timeout.',
        };
    }

    const timeoutResult = await applyTimeout(member);

    if (!timeoutResult.ok) {
        return {
            coins: 0,
            trapped: true,
            summary: 'trapped (timeout failed)',
            message: 'Trouble! The VDV2 chest was trapped, but I could not apply the timeout. Check my Moderate Members permission and role position.',
        };
    }

    return {
        coins: 0,
        trapped: true,
        summary: `trapped (${CONFIG.timeoutMinutes} min timeout)`,
        message: `Trouble! The VDV2 chest was trapped - timed out for **${CONFIG.timeoutMinutes} minutes**.`,
    };
}

async function applyTimeout(member) {
    try {
        if (!member?.moderatable) {
            return { ok: false };
        }

        await member.timeout(CONFIG.timeoutMinutes * 60 * 1000, 'VDV2 chest trap');
        return { ok: true };
    } catch (error) {
        console.error(`Could not timeout ${member?.id}:`, error);
        return { ok: false };
    }
}

async function updateChestMessage(interaction, chest) {
    const payload = buildChestPayload(chest);

    try {
        await interaction.message.edit(payload);
    } catch (error) {
        console.error('Could not edit chest message from interaction:', error);

        try {
            const channel = await client.channels.fetch(chest.channelId);
            const message = await channel.messages.fetch(chest.messageId);
            await message.edit(payload);
        } catch (fetchError) {
            console.error('Could not refetch and edit chest message:', fetchError);
        }
    }
}

async function getGuildMember(interaction) {
    if (!interaction.guild) {
        return null;
    }

    try {
        return await interaction.guild.members.fetch(interaction.user.id);
    } catch (error) {
        console.error(`Could not fetch member ${interaction.user.id}:`, error);
        return interaction.member;
    }
}

function chooseOutcome(member) {
    const hasTag = CONFIG.vdv2TagRoleId && memberHasRole(member, CONFIG.vdv2TagRoleId);
    const weights = hasTag
        ? { coins: 70, empty: 20, trap: 10 }
        : { coins: 45, empty: 35, trap: 20 };

    const roll = Math.random() * (weights.coins + weights.empty + weights.trap);

    if (roll < weights.coins) {
        return 'coins';
    }

    if (roll < weights.coins + weights.empty) {
        return 'empty';
    }

    return 'trap';
}

function memberHasRole(member, roleId) {
    if (!member || !roleId) {
        return false;
    }

    if (member.roles?.cache?.has(roleId)) {
        return true;
    }

    return Array.isArray(member.roles) && member.roles.includes(roleId);
}

function isBooster(member) {
    if (!member) {
        return false;
    }

    if (CONFIG.boosterRoleId && memberHasRole(member, CONFIG.boosterRoleId)) {
        return true;
    }

    return Boolean(member.premiumSince || member.premiumSinceTimestamp);
}

function addCoins(userId, amount) {
    const current = getCoins(userId);
    const next = Math.max(0, current + amount);
    data.coins[userId] = next;
    return next;
}

function normalizeCoins(coins) {
    if (!coins || typeof coins !== 'object' || Array.isArray(coins)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(coins)
            .map(([userId, amount]) => [userId, Number.parseInt(amount, 10)])
            .filter(([userId, amount]) => /^\d{10,25}$/.test(userId) && Number.isFinite(amount) && amount >= 0)
    );
}

function countBalances() {
    return Object.keys(data.coins).length;
}

async function fetchRecentMessages(channel, limit) {
    const messages = [];
    let before;

    while (messages.length < limit) {
        const batchSize = Math.min(100, limit - messages.length);
        const batch = await channel.messages.fetch({
            limit: batchSize,
            before,
        });

        if (!batch.size) {
            break;
        }

        messages.push(...batch.values());
        before = batch.last().id;
    }

    return messages;
}

function rebuildCoinsFromMessages(messages) {
    const coins = {};
    let summaryCount = 0;

    for (const message of messages) {
        for (const embed of message.embeds || []) {
            const title = embed.title || '';
            const description = embed.description || '';

            if (!/fully looted/i.test(title) || !description) {
                continue;
            }

            let foundAnyLine = false;

            for (const line of description.split('\n')) {
                const parsed = parseSummaryCoinLine(line);

                if (!parsed) {
                    continue;
                }

                coins[parsed.userId] = (coins[parsed.userId] || 0) + parsed.amount;
                foundAnyLine = true;
            }

            if (foundAnyLine) {
                summaryCount += 1;
            }
        }
    }

    return { coins, summaryCount };
}

function parseSummaryCoinLine(line) {
    const mention = line.match(/<@!?(\d{10,25})>/);

    if (!mention) {
        return null;
    }

    const amount = line.match(/[-–—]\s*(\d+)\s+(?:VDV2\s+)?Coins?\b/i);

    if (!amount) {
        return null;
    }

    return {
        userId: mention[1],
        amount: Number.parseInt(amount[1], 10),
    };
}

function getCoins(userId) {
    return Number(data.coins[userId] || 0);
}

function openedCount(chest) {
    return Object.keys(chest.openedBy || {}).length;
}

function getChestChannelId() {
    return data.settings.chestChannelId || CONFIG.chestChannelId || '';
}

function getAutoMinutes() {
    const savedMinutes = Number.parseInt(data.settings.autoMinutes, 10);

    if (Number.isFinite(savedMinutes) && savedMinutes >= 0) {
        return savedMinutes;
    }

    return CONFIG.autoMinutes;
}

function getChestImageFile() {
    if (CONFIG.chestImageUrl || !CONFIG.chestImagePath || !fs.existsSync(CONFIG.chestImagePath)) {
        return null;
    }

    return {
        attachment: CONFIG.chestImagePath,
        name: CHEST_IMAGE_ATTACHMENT_NAME,
    };
}

function loadData() {
    ensureDataDir();

    if (!fs.existsSync(DATA_FILE)) {
        return normalizeData({});
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return normalizeData(parsed);
    } catch (error) {
        console.error('Could not read data file, starting with empty data:', error);
        return normalizeData({});
    }
}

function normalizeData(parsed) {
    return {
        coins: normalizeCoins(parsed.coins),
        chests: parsed.chests || {},
        settings: parsed.settings || {},
    };
}

function saveData() {
    ensureDataDir();
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    fs.renameSync(tmpFile, DATA_FILE);
}

function ensureDataDir() {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
}

function readInt(name, fallback) {
    const raw = process.env[name];

    if (!raw) {
        return fallback;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function readBool(name, fallback) {
    const raw = process.env[name];

    if (!raw) {
        return fallback;
    }

    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function resolveProjectPath(filePath) {
    if (!filePath || path.isAbsolute(filePath)) {
        return filePath;
    }

    return path.resolve(__dirname, filePath);
}

async function fetchJsonAttachment(attachment) {
    if (!attachment.name?.toLowerCase().endsWith('.json')) {
        throw new Error('Backup file must be a JSON file.');
    }

    const response = await fetch(attachment.url);

    if (!response.ok) {
        throw new Error(`Could not download backup file: ${response.status}`);
    }

    return response.json();
}

function randomInt(min, max) {
    const safeMin = Math.min(min, max);
    const safeMax = Math.max(min, max);
    return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function userMention(userId) {
    return `<@${userId}>`;
}

function channelMention(channelId) {
    return `<#${channelId}>`;
}

function roleMention(roleId) {
    return `<@&${roleId}>`;
}

async function safeInteractionReply(interaction, payload) {
    if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
        return;
    }

    await interaction.reply(payload).catch(() => {});
}

function shutdown() {
    console.log('Shutting down VDV2 Chest Bot...');
    client.destroy();
    process.exit(0);
}
