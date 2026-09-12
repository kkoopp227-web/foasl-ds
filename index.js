require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const db = require('./database');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const commands = [
    new SlashCommandBuilder()
        .setName('setup-separator')
        .setDescription('إعداد الفاصل لشات معين')
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('الشات الذي سيتم إرسال الفاصل فيه')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('url')
                .setDescription('رابط صورة الفاصل')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('رفع صورة للفاصل')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

    new SlashCommandBuilder()
        .setName('stop-separator')
        .setDescription('إيقاف الفاصل في شات معين')
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('الشات')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

    new SlashCommandBuilder()
        .setName('setup-reaction')
        .setDescription('إعداد التفاعل التلقائي (الرياكشن) لشات معين')
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('الشات')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('emoji')
                .setDescription('الإيموجي (يمكنك وضع أكثر من إيموجي بينهم مسافة، مثل: 👍 ❤️)')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

    new SlashCommandBuilder()
        .setName('stop-reaction')
        .setDescription('إيقاف التفاعل التلقائي في شات معين')
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('الشات')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    try {
        console.log('Started refreshing application (/) commands.');
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (process.env.ADMIN_CHANNEL_ID && interaction.channel.id !== process.env.ADMIN_CHANNEL_ID) {
        return interaction.reply({ content: 'عذراً، لا يمكنك استخدام أوامر التحكم إلا في الشات المخصص لها.', ephemeral: true });
    }

    if (interaction.commandName === 'setup-separator') {
        const channel = interaction.options.getChannel('channel');
        const url = interaction.options.getString('url');
        const attachment = interaction.options.getAttachment('image');

        let finalUrl = null;
        if (attachment) {
            finalUrl = attachment.url;
        } else if (url) {
            finalUrl = url;
        }

        if (!finalUrl) {
            return interaction.reply({ content: 'يجب عليك إما وضع رابط الصورة أو رفع صورة!', ephemeral: true });
        }

        try {
            await db.setSeparator(channel.id, finalUrl);
            await interaction.reply({ content: `تم إعداد الفاصل بنجاح في شات ${channel}`, ephemeral: true });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'حدث خطأ أثناء حفظ الإعدادات.', ephemeral: true });
        }
    }

    if (interaction.commandName === 'stop-separator') {
        const channel = interaction.options.getChannel('channel');
        try {
            await db.removeSeparator(channel.id);
            await interaction.reply({ content: `تم إيقاف الفاصل في شات ${channel}`, ephemeral: true });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'حدث خطأ أثناء حفظ الإعدادات.', ephemeral: true });
        }
    }

    if (interaction.commandName === 'setup-reaction') {
        const channel = interaction.options.getChannel('channel');
        const emoji = interaction.options.getString('emoji');
        try {
            await db.setReaction(channel.id, emoji);
            await interaction.reply({ content: `تم إعداد الرياكشن التلقائي ${emoji} في شات ${channel}`, ephemeral: true });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'حدث خطأ أثناء حفظ الإعدادات.', ephemeral: true });
        }
    }

    if (interaction.commandName === 'stop-reaction') {
        const channel = interaction.options.getChannel('channel');
        try {
            await db.removeReaction(channel.id);
            await interaction.reply({ content: `تم إيقاف الرياكشن التلقائي في شات ${channel}`, ephemeral: true });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'حدث خطأ أثناء حفظ الإعدادات.', ephemeral: true });
        }
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Check Auto Reaction
    try {
        const reactionData = await db.getReaction(message.channel.id);
        if (reactionData && reactionData.emoji) {
            // Split emojis by space in case the user provided multiple
            const emojis = reactionData.emoji.split(/\s+/).filter(e => e.trim() !== '');
            for (const emj of emojis) {
                await message.react(emj).catch(err => console.error(`Error reacting with ${emj}`, err.message));
            }
        }
    } catch (error) {
        console.error('Error fetching reaction config', error);
    }

    // Check Separator
    try {
        const separatorData = await db.getSeparator(message.channel.id);
        if (separatorData && separatorData.separator_url) {
            // Simply send the new separator without deleting the old one
            const newSeparator = await message.channel.send(separatorData.separator_url);
            await db.setLastSeparatorMessage(message.channel.id, newSeparator.id);
        }
    } catch (error) {
        console.error('Error handling separator', error);
    }
});

client.login(process.env.DISCORD_TOKEN);
