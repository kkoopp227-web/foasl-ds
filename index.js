require('dotenv').config();
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(port, () => console.log(`Dummy server listening at http://localhost:${port}`));

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
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

    new SlashCommandBuilder()
        .setName('auto-delete')
        .setDescription('إعداد الحذف التلقائي لرسائل الرومات')
        .addChannelOption(option => 
            option.setName('channel1')
                .setDescription('الشات الأول')
                .setRequired(true))
        .addChannelOption(option => 
            option.setName('channel2')
                .setDescription('الشات الثاني (اختياري)')
                .setRequired(false))
        .addChannelOption(option => 
            option.setName('channel3')
                .setDescription('الشات الثالث (اختياري)')
                .setRequired(false))
        .addChannelOption(option => 
            option.setName('channel4')
                .setDescription('الشات الرابع (اختياري)')
                .setRequired(false))
        .addChannelOption(option => 
            option.setName('channel5')
                .setDescription('الشات الخامس (اختياري)')
                .setRequired(false))
        .addIntegerOption(option => 
            option.setName('duration')
                .setDescription('المدة بالدقائق قبل حذف الرسائل')
                .setRequired(true)
                .setMinValue(1))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

    new SlashCommandBuilder()
        .setName('stop-auto-delete')
        .setDescription('إيقاف الحذف التلقائي لرسائل الرومات')
        .addChannelOption(option => 
            option.setName('channel1')
                .setDescription('الشات الأول')
                .setRequired(true))
        .addChannelOption(option => 
            option.setName('channel2')
                .setDescription('الشات الثاني (اختياري)')
                .setRequired(false))
        .addChannelOption(option => 
            option.setName('channel3')
                .setDescription('الشات الثالث (اختياري)')
                .setRequired(false))
        .addChannelOption(option => 
            option.setName('channel4')
                .setDescription('الشات الرابع (اختياري)')
                .setRequired(false))
        .addChannelOption(option => 
            option.setName('channel5')
                .setDescription('الشات الخامس (اختياري)')
                .setRequired(false))
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

    // Auto-delete sweep: every 60 seconds, delete expired messages in configured channels
    setInterval(async () => {
        try {
            const configs = await db.getAllAutoDeletes();
            if (!configs || configs.length === 0) return;

            for (const config of configs) {
                const channel = await client.channels.fetch(config.channel_id).catch(() => null);
                if (!channel || !channel.isTextBased()) continue;

                const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
                if (!messages) continue;

                const cutoff = Date.now() - config.duration_minutes * 60 * 1000;
                for (const msg of messages.values()) {
                    if (!msg.pinned && msg.createdTimestamp < cutoff) {
                        await msg.delete().catch(() => {});
                    }
                }
            }
        } catch (error) {
            console.error('Error in auto-delete sweep:', error.message);
        }
    }, 60 * 1000);
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

        const isFullUrl = /^https?:\/\//i.test(finalUrl);
        const isExistingFile = fs.existsSync(path.join(__dirname, finalUrl));
        if (!isFullUrl && !isExistingFile) {
            return interaction.reply({ content: 'القيمة المُدخلة ليست رابط صورة صحيح وليست ملف موجود في المشروع. ارفع الصورة من خيار (image) أو ضع رابطاً كاملاً يبدأ بـ https://', ephemeral: true });
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

    if (interaction.commandName === 'auto-delete') {
        const channels = [];
        for (let i = 1; i <= 5; i++) {
            const ch = interaction.options.getChannel(`channel${i}`);
            if (ch) channels.push(ch);
        }
        const duration = interaction.options.getInteger('duration');
        try {
            for (const ch of channels) {
                await db.setAutoDelete(ch.id, duration);
            }
            await interaction.reply({
                content: `تم تفعيل الحذف التلقائي لـ ${channels.length} روم، الرسائل تُحذف بعد ${duration} دقيقة.\nالرومات: ${channels.join(' ')}`,
                ephemeral: true
            });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'حدث خطأ أثناء حفظ الإعدادات.', ephemeral: true });
        }
    }

    if (interaction.commandName === 'stop-auto-delete') {
        const channels = [];
        for (let i = 1; i <= 5; i++) {
            const ch = interaction.options.getChannel(`channel${i}`);
            if (ch) channels.push(ch);
        }
        try {
            for (const ch of channels) {
                await db.removeAutoDelete(ch.id);
            }
            await interaction.reply({
                content: `تم إيقاف الحذف التلقائي لـ ${channels.length} روم: ${channels.join(' ')}`,
                ephemeral: true
            });
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
            const url = separatorData.separator_url;
            let separatorMessage;

            if (/^https?:\/\//i.test(url)) {
                const embed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setImage(url);
                separatorMessage = await message.channel.send({ embeds: [embed] });
            } else if (fs.existsSync(path.join(__dirname, url))) {
                separatorMessage = await message.channel.send({ files: [path.join(__dirname, url)] });
            } else {
                separatorMessage = await message.channel.send({ content: url });
            }

            await db.setLastSeparatorMessage(message.channel.id, separatorMessage.id);
        }
    } catch (error) {
        console.error('Error handling separator', error);
    }
});

client.login(process.env.DISCORD_TOKEN);
