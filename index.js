require('dotenv').config();
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(port, () => console.log(`Dummy server listening at http://localhost:${port}`));

const {
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes,
    ChannelSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType,
    SlashCommandBuilder, PermissionsBitField
} = require('discord.js');
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

const PREFIX = process.env.PREFIX || '-';

function isAdminChannel(channelId) {
    if (process.env.ADMIN_CHANNEL_ID && channelId !== process.env.ADMIN_CHANNEL_ID) {
        return false;
    }
    return true;
}

function isAllowedGuild(guildId) {
    if (!process.env.GUILD_ID) return true;
    return String(process.env.GUILD_ID) === String(guildId);
}

function hasAdminRole(member) {
    if (!process.env.ADMIN_ROLE_ID) return true;
    return !!member && !!member.roles && member.roles.cache.has(process.env.ADMIN_ROLE_ID);
}

const commands = [
    new SlashCommandBuilder()
        .setName('setup-separator')
        .setDescription('إعداد الفاصل (افتح اللوحة واختر الرومات)')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('رابط صورة الفاصل')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('رفع صورة الفاصل')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

    new SlashCommandBuilder()
        .setName('stop-separator')
        .setDescription('إيقاف الفاصل في شات')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('الشات')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

    new SlashCommandBuilder()
        .setName('setup-reaction')
        .setDescription('إعداد الرياكشن التلقائي (افتح اللوحة واختر الرومات)')
        .addStringOption(option =>
            option.setName('emoji')
                .setDescription('الإيموجي (اختياري، يمكن تغييره من اللوحة)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

    new SlashCommandBuilder()
        .setName('stop-reaction')
        .setDescription('إيقاف الرياكشن التلقائي')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('الشات')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

    new SlashCommandBuilder()
        .setName('auto-delete')
        .setDescription('إعداد الحذف التلقائي (افتح اللوحة واختر الرومات)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

    new SlashCommandBuilder()
        .setName('stop-auto-delete')
        .setDescription('إيقاف الحذف التلقائي')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('الروم')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

    new SlashCommandBuilder()
        .setName('send')
        .setDescription('إرسال نص و/أو صور إلى شات')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('الشات الذي سيُرسل إليه')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('text')
                .setDescription('النص المراد إرساله (اختياري)')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('image1')
                .setDescription('الصورة الأولى (اختياري)')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('image2')
                .setDescription('الصورة الثانية (اختياري)')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('image3')
                .setDescription('الصورة الثالثة (اختياري)')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('image4')
                .setDescription('الصورة الرابعة (اختياري)')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('image5')
                .setDescription('الصورة الخامسة (اختياري)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
].map(c => c.toJSON());

// ---------- Interactive panel state (key: user id) ----------
const panels = new Map(); // userId -> { type, channels:Set, duration:number|null, src:string|null }

async function sendBareImages(channel, text, imageUrls) {
    const cleanText = (text && text.trim()) || null;

    if (imageUrls.length === 0) {
        return await channel.send({ content: cleanText });
    }

    let firstMessage = null;
    for (let i = 0; i < imageUrls.length; i++) {
        const payload = { files: [imageUrls[i]] };
        if (i === 0) payload.content = cleanText || null;
        const msg = await channel.send(payload);
        if (i === 0) firstMessage = msg;
    }
    return firstMessage;
}

function panelEmbed(state) {
    const embed = new EmbedBuilder().setColor('#2b2d31');

    if (state.type === 'auto-delete') {
        embed.setTitle('إعداد الحذف التلقائي');
        embed.setDescription(
            '1- اختر الرومات الصوتية من القائمة أدناه.\n' +
            '2- اضغط زر «المدة» واكتب الوقت بالدقائق.\n' +
            '3- اضغط «تشغيل» لتطبيق الإعداد.'
        );
    } else if (state.type === 'separator') {
        embed.setTitle('إعداد الفاصل');
        embed.setDescription(
            '1- اختر الشاتات من القائمة أدناه.\n' +
            '2- اضغط زر «الصورة» وضع رابط صورة الفاصل (إن لم تكن جاهزة).\n' +
            '3- اضغط «تشغيل» لتطبيق الفاصل على الشاتات المحددة.'
        );
    } else {
        embed.setTitle('إعداد الرياكشن التلقائي');
        embed.setDescription(
            '1- اختر الشاتات من القائمة أدناه.\n' +
            '2- اضغط زر «الإيموجي» واكتب الإيموجي (ممكن أكثر من واحد بمسافة).\n' +
            '3- اضغط «تشغيل» لتطبيق الإعداد.'
        );
    }

    const channelsList = state.channels.size
        ? [...state.channels].map(id => `<#${id}>`).join(' ')
        : 'لم تختار بعد';
    embed.addFields(
        { name: 'الرومات المحددة', value: channelsList, inline: false }
    );

    if (state.type === 'auto-delete') {
        embed.addFields({
            name: 'المدة',
            value: state.duration != null ? `${state.duration} دقيقة` : 'لم تحدد بعد',
            inline: false
        });
    }

    if (state.type === 'reaction') {
        embed.addFields({
            name: 'الإيموجي',
            value: state.emoji || 'لم تحدد بعد',
            inline: false
        });
    }

    return embed;
}

function autoDeleteRow() {
    const chRow = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('autodel_channels')
            .setPlaceholder('اختر الرومات الصوتية (ممكن أكثر من واحد)')
            .setChannelTypes([ChannelType.GuildVoice])
            .setMinValues(1)
            .setMaxValues(25)
    );
    const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('autodel_duration').setLabel('المدة').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('autodel_apply').setLabel('تشغيل').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('autodel_cancel').setLabel('إلغاء').setStyle(ButtonStyle.Danger)
    );
    return [chRow, btnRow];
}

function separatorRow() {
    const chRow = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('sep_channels')
            .setPlaceholder('اختر الشاتات (ممكن أكثر من واحد)')
            .setChannelTypes([ChannelType.GuildText])
            .setMinValues(1)
            .setMaxValues(25)
    );
    const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('sep_image').setLabel('الصورة').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('sep_apply').setLabel('تشغيل').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('sep_cancel').setLabel('إلغاء').setStyle(ButtonStyle.Danger)
    );
    return [chRow, btnRow];
}

function reactionRow() {
    const chRow = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('react_channels')
            .setPlaceholder('اختر الشاتات (ممكن أكثر من واحد)')
            .setChannelTypes([ChannelType.GuildText])
            .setMinValues(1)
            .setMaxValues(25)
    );
    const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('react_emoji').setLabel('الإيموجي').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('react_apply').setLabel('تشغيل').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('react_cancel').setLabel('إلغاء').setStyle(ButtonStyle.Danger)
    );
    return [chRow, btnRow];
}

async function sendAutoDeletePanel(channel, userId) {
    const state = {
        type: 'auto-delete',
        channels: new Set(),
        duration: null
    };
    panels.set(userId, state);
    await channel.send({
        embeds: [panelEmbed(state)],
        components: autoDeleteRow()
    });
}

async function sendSeparatorPanel(channel, userId, src) {
    const state = {
        type: 'separator',
        channels: new Set(),
        src: src
    };
    panels.set(userId, state);
    await channel.send({
        embeds: [panelEmbed(state)],
        components: separatorRow()
    });
}

// ---------- Ready ----------
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    try {
        // Register slash commands
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }

    // Auto-delete sweep every 60 seconds
    setInterval(async () => {
        try {
            const configs = await db.getAllAutoDeletes();
            if (!configs || configs.length === 0) return;

            for (const config of configs) {
                const channel = await client.channels.fetch(config.channel_id, { force: true }).catch(() => null);
                if (!channel || !isAllowedGuild(channel.guildId)) continue;

                try {
                    const data = await client.rest.get(`/channels/${config.channel_id}/messages?limit=100`);
                    const cutoff = Date.now() - config.duration_minutes * 60 * 1000;
                    for (const msg of data) {
                        if (!msg.pinned && Date.parse(msg.timestamp) < cutoff) {
                            await client.rest.delete(`/channels/${config.channel_id}/messages/${msg.id}`).catch(() => {});
                        }
                    }
                } catch (err) {
                    if (!err.message || !err.message.startsWith('Unknown Channel')) {
                        console.error('Auto-delete channel error:', err.message);
                    }
                }
            }
        } catch (error) {
            console.error('Error in auto-delete sweep:', error.message);
        }
    }, 60 * 1000);
});

// ---------- Component interactions (panels) ----------
client.on('interactionCreate', async interaction => {
    if (!isAllowedGuild(interaction.guild && interaction.guild.id)) return;

    if (interaction.isChatInputCommand()) {
        if (!isAdminChannel(interaction.channel.id)) {
            return interaction.reply({ content: 'عذراً، لا يمكنك استخدام أوامر التحكم إلا في الشات المخصص لها.', ephemeral: true });
        }
        if (!hasAdminRole(interaction.member)) {
            return interaction.reply({ content: 'عذراً، لا تملك الرول المطلوب لاستخدام هذه الأوامر.', ephemeral: true });
        }

        const name = interaction.commandName;

        if (name === 'auto-delete') {
            const state = { type: 'auto-delete', channels: new Set(), duration: null };
            panels.set(interaction.user.id, state);
            return interaction.reply({
                embeds: [panelEmbed(state)],
                components: autoDeleteRow()
            });
        }

        if (name === 'setup-separator') {
            const url = interaction.options.getString('url');
            const attachment = interaction.options.getAttachment('image');
            let src = null;
            if (attachment) {
                src = attachment.url;
            } else if (url && url.trim()) {
                src = url.trim();
            }
            if (src) {
                const isFullUrl = /^https?:\/\//i.test(src);
                const isExistingFile = fs.existsSync(path.join(__dirname, src));
                if (!isFullUrl && !isExistingFile) src = null;
            }
            const state = { type: 'separator', channels: new Set(), src };
            panels.set(interaction.user.id, state);
            return interaction.reply({
                embeds: [panelEmbed(state)],
                components: separatorRow()
            });
        }

        if (name === 'stop-separator') {
            const channel = interaction.options.getChannel('channel');
            try {
                await db.removeSeparator(channel.id);
                return interaction.reply({ content: `تم إيقاف الفاصل في شات ${channel}`, ephemeral: true });
            } catch (error) {
                console.error(error);
                return interaction.reply({ content: 'حدث خطأ أثناء حفظ الإعدادات.', ephemeral: true });
            }
        }

        if (name === 'setup-reaction') {
            const emoji = interaction.options.getString('emoji');
            const state = { type: 'reaction', channels: new Set(), emoji: emoji || null };
            panels.set(interaction.user.id, state);
            return interaction.reply({
                embeds: [panelEmbed(state)],
                components: reactionRow()
            });
        }

        if (name === 'stop-reaction') {
            const channel = interaction.options.getChannel('channel');
            try {
                await db.removeReaction(channel.id);
                return interaction.reply({ content: `تم إيقاف الرياكشن التلقائي في شات ${channel}`, ephemeral: true });
            } catch (error) {
                console.error(error);
                return interaction.reply({ content: 'حدث خطأ أثناء حفظ الإعدادات.', ephemeral: true });
            }
        }

        if (name === 'stop-auto-delete') {
            const channel = interaction.options.getChannel('channel');
            try {
                await db.removeAutoDelete(channel.id);
                return interaction.reply({ content: `تم إيقاف الحذف التلقائي في روم ${channel}`, ephemeral: true });
            } catch (error) {
                console.error(error);
                return interaction.reply({ content: 'حدث خطأ أثناء حفظ الإعدادات.', ephemeral: true });
            }
        }

        if (name === 'send') {
            const channel = interaction.options.getChannel('channel');
            const text = interaction.options.getString('text');
            const files = [];
            for (let i = 1; i <= 5; i++) {
                const att = interaction.options.getAttachment(`image${i}`);
                if (att) files.push(att.url);
            }

            if ((!text || !text.trim()) && files.length === 0) {
                return interaction.reply({ content: 'اكتب نصاً أو ارفع صورة واحدة على الأقل.', ephemeral: true });
            }

            try {
                const sent = await sendBareImages(channel, text, files);
                return interaction.reply({
                    content: `✅ تم الإرسال إلى ${channel}` +
                        (files.length ? ` مع ${files.length} صورة (أول وحدة فوق واللي بعدها تحت، بدون مربعات)` : '') +
                        (sent && sent.id ? `\nرابط الرسالة: https://discord.com/channels/${channel.guildId}/${channel.id}/${sent.id}` : ''),
                    ephemeral: true
                });
            } catch (error) {
                console.error(error);
                return interaction.reply({ content: `حدث خطأ أثناء الإرسال. تأكد أن البوت عنده صلاحية الكتابة في ${channel}`, ephemeral: true });
            }
        }

        return;
    }

    const userId = interaction.user.id;

    // Channel selection updates
    if (interaction.isChannelSelectMenu()) {
        if (interaction.customId === 'react_channels') {
            const state = panels.get(userId);
            if (!state || state.type !== 'reaction') return;

            state.channels = new Set(interaction.values);
            await interaction.update({
                embeds: [panelEmbed(state)],
                components: reactionRow()
            });
            return;
        }

        if (interaction.customId === 'autodel_channels' || interaction.customId === 'sep_channels') {
            const state = panels.get(userId);
            if (!state) return;

            state.channels = new Set(interaction.values);
            const rows = state.type === 'auto-delete' ? autoDeleteRow() : separatorRow();
            await interaction.update({
                embeds: [panelEmbed(state)],
                components: rows
            });
        }
        return;
    }

    // Buttons
    if (interaction.isButton()) {
        const state = panels.get(userId);

        if (interaction.customId === 'autodel_duration') {
            if (!state || state.type !== 'auto-delete') return;
            const modal = new ModalBuilder()
                .setCustomId('autodel_time')
                .setTitle('المدة بالدقائق')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('minutes')
                            .setLabel('عدد الدقائق قبل حذف الرسائل')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setPlaceholder('مثال: 5')
                    )
                );
            return interaction.showModal(modal);
        }

        if (interaction.customId === 'autodel_apply') {
            if (!state || state.type !== 'auto-delete') return;
            if (state.channels.size === 0) {
                return interaction.reply({ content: 'اختر الرومات أولاً من القائمة.', ephemeral: true });
            }
            if (state.duration == null) {
                return interaction.reply({ content: 'اضغط زر «المدة» واكتب الوقت قبل التشغيل.', ephemeral: true });
            }
            try {
                for (const id of state.channels) {
                    await db.setAutoDelete(id, state.duration);
                }
                const done = new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle('تم التفعيل')
                    .setDescription(
                        `راح تُحذف الرسائل تلقائياً بعد **${state.duration} دقيقة** في:\n` +
                        [...state.channels].map(id => `<#${id}>`).join(' ')
                    );
                panels.delete(userId);
                await interaction.update({ embeds: [done], components: [] });
                return interaction.followUp({ content: '🔔 تم تشغيل الحذف التلقائي بنجاح.', ephemeral: true });
            } catch (error) {
                console.error(error);
                return interaction.reply({ content: 'حدث خطأ أثناء الحفظ.', ephemeral: true });
            }
        }

        if (interaction.customId === 'sep_apply') {
            if (!state || state.type !== 'separator') return;
            if (state.channels.size === 0) {
                return interaction.reply({ content: 'اختر الشاتات أولاً من القائمة.', ephemeral: true });
            }
            if (!state.src) {
                return interaction.reply({ content: 'اضغط زر «الصورة» وضع رابط صورة الفاصل قبل التشغيل.', ephemeral: true });
            }
            try {
                for (const id of state.channels) {
                    await db.setSeparator(id, state.src);
                }
                const done = new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle('تم التفعيل')
                    .setDescription(
                        `تم إعداد الفاصل في:\n` +
                        [...state.channels].map(id => `<#${id}>`).join(' ')
                    );
                panels.delete(userId);
                await interaction.update({ embeds: [done], components: [] });
                return interaction.followUp({ content: '🔔 تم تشغيل الفاصل بنجاح.', ephemeral: true });
            } catch (error) {
                console.error(error);
                return interaction.reply({ content: 'حدث خطأ أثناء الحفظ.', ephemeral: true });
            }
        }

        if (interaction.customId === 'autodel_cancel' || interaction.customId === 'sep_cancel') {
            panels.delete(userId);
            const cancelled = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('تم الإلغاء')
                .setDescription('لم يتم تطبيق أي إعداد.');
            await interaction.update({ embeds: [cancelled], components: [] });
            return interaction.followUp({ content: 'أُلغي الإعداد.', ephemeral: true });
        }

        if (interaction.customId === 'react_emoji') {
            if (!state || state.type !== 'reaction') return;
            const modal = new ModalBuilder()
                .setCustomId('react_emoji_modal')
                .setTitle('الإيموجي')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('emoji')
                            .setLabel('اكتب الإيموجي (أكثر من واحد بمسافة)')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setPlaceholder('مثال: 👍 ❤️ 😂')
                    )
                );
            return interaction.showModal(modal);
        }

        if (interaction.customId === 'sep_image') {
            if (!state || state.type !== 'separator') return;
            const modal = new ModalBuilder()
                .setCustomId('sep_image_modal')
                .setTitle('صورة الفاصل')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('image_url')
                            .setLabel('ضع رابط صورة الفاصل')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setPlaceholder('https://example.com/image.png')
                    )
                );
            return interaction.showModal(modal);
        }

        if (interaction.customId === 'react_apply') {
            if (!state || state.type !== 'reaction') return;
            if (state.channels.size === 0) {
                return interaction.reply({ content: 'اختر الرومات أولاً من القائمة.', ephemeral: true });
            }
            if (!state.emoji) {
                return interaction.reply({ content: 'اضغط زر «الإيموجي» واكتب الإيموجي قبل التشغيل.', ephemeral: true });
            }
            try {
                for (const id of state.channels) {
                    await db.setReaction(id, state.emoji);
                }
                const done = new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle('تم التفعيل')
                    .setDescription(
                        `راح يضيف البوت **${state.emoji}** على كل رسالة في:\n` +
                        [...state.channels].map(id => `<#${id}>`).join(' ')
                    );
                panels.delete(userId);
                await interaction.update({ embeds: [done], components: [] });
                return interaction.followUp({ content: '🔔 تم تشغيل الرياكشن التلقائي بنجاح.', ephemeral: true });
            } catch (error) {
                console.error(error);
                return interaction.reply({ content: 'حدث خطأ أثناء الحفظ.', ephemeral: true });
            }
        }

        if (interaction.customId === 'react_cancel') {
            panels.delete(userId);
            const cancelled = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('تم الإلغاء')
                .setDescription('لم يتم تطبيق أي إعداد.');
            await interaction.update({ embeds: [cancelled], components: [] });
            return interaction.followUp({ content: 'أُلغي الإعداد.', ephemeral: true });
        }

        return;
    }

    // Modal submit
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'autodel_time') {
            const state = panels.get(userId);
            if (!state || state.type !== 'auto-delete') return;

            const minutes = parseInt(interaction.fields.getTextInputValue('minutes'), 10);
            if (isNaN(minutes) || minutes < 1) {
                return interaction.reply({ content: 'المدة يجب أن تكون رقماً صحيحاً أكبر من صفر.', ephemeral: true });
            }
            state.duration = minutes;
            await interaction.update({
                embeds: [panelEmbed(state)],
                components: autoDeleteRow()
            });
            return;
        }

        if (interaction.customId === 'react_emoji_modal') {
            const state = panels.get(userId);
            if (!state || state.type !== 'reaction') return;

            const emoji = interaction.fields.getTextInputValue('emoji').trim();
            if (!emoji) {
                return interaction.reply({ content: 'يجب كتابة إيموجي واحد على الأقل.', ephemeral: true });
            }
            state.emoji = emoji;
            await interaction.update({
                embeds: [panelEmbed(state)],
                components: reactionRow()
            });
            return;
        }

        if (interaction.customId === 'sep_image_modal') {
            const state = panels.get(userId);
            if (!state || state.type !== 'separator') return;

            const value = interaction.fields.getTextInputValue('image_url').trim();
            const isFullUrl = /^https?:\/\//i.test(value);
            const isExistingFile = fs.existsSync(path.join(__dirname, value));
            if (!isFullUrl && !isExistingFile) {
                return interaction.reply({ content: 'رابط الصورة غير صحيح. ضع رابطاً كاملاً يبدأ بـ https://', ephemeral: true });
            }
            state.src = value;
            await interaction.update({
                embeds: [panelEmbed(state)],
                components: separatorRow()
            });
        }
        return;
    }
});

// ---------- Prefix commands ----------
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!isAllowedGuild(message.guild && message.guild.id)) return;

    if (message.content.trimStart().startsWith(PREFIX)) {
        const content = message.content.slice(PREFIX.length).trim();
        const args = content.split(/\s+/).filter(a => a !== '');
        const name = (args.shift() || '').toLowerCase();

        if (!isAdminChannel(message.channel.id)) {
            return message.reply('عذراً، لا يمكنك استخدام الأوامر إلا في الشات المخصص لها.');
        }
        if (!hasAdminRole(message.member)) {
            return message.reply('عذراً، لا تملك الرول المطلوب لاستخدام هذه الأوامر.');
        }

        if (name === 'send') {
            const target = message.mentions.channels.first();
            if (!target) {
                return message.reply('يجب أن تذكر الشات أولاً: `-send #الشات النص المكتوب`');
            }

            const text = args
                .filter(a => !/^<#\d+>$/.test(a))
                .join(' ');
            const files = message.attachments.map(a => a.url);

            if (!text && files.length === 0) {
                return message.reply('اكتب نصاً أو ارفع صورة واحدة على الأقل لإرسالها.');
            }

            try {
                await sendBareImages(target, text, files);
                return message.reply(
                    `✅ تم الإرسال إلى ${target}` +
                    (files.length ? ` مع ${files.length} صورة (أول وحدة فوق واللي بعدها تحت، بدون مربعات)` : '') +
                    (text ? `\nالنص: ${text}` : '')
                );
            } catch (error) {
                console.error(error);
                return message.reply(`حدث خطأ أثناء الإرسال. تأكد أن البوت عنده صلاحية الكتابة في ${target}`);
            }
        }

        if (name === 'auto-delete') {
            await sendAutoDeletePanel(message.channel, message.author.id);
            return;
        }

        if (name === 'setup-separator') {
            let src = null;
            const attachment = message.attachments.first();
            if (attachment) {
                src = attachment.url;
            } else if (args[0]) {
                src = args[0];
            }
            if (src) {
                const isFullUrl = /^https?:\/\//i.test(src);
                const isExistingFile = fs.existsSync(path.join(__dirname, src));
                if (!isFullUrl && !isExistingFile) src = null;
            }

            await sendSeparatorPanel(message.channel, message.author.id, src);
            return;
        }

        return message.reply(
            'الأوامر المتاحة:\n' +
            `- \`${PREFIX}auto-delete\` → لوحة الحذف التلقائي (اختر الرومات + المدة + تشغيل)\n` +
            `- \`${PREFIX}setup-separator\` → لوحة الفاصل (اختر الشاتات + الصورة + تشغيل)\n` +
            `- \`${PREFIX}send #الشات النص\` → يرسل نص وصور في شات (ارفق الصور بالترتيب مع الأمر)`
        );
    }

    // Auto Reaction (runtime)
    try {
        const reactionData = await db.getReaction(message.channel.id);
        if (reactionData && reactionData.emoji) {
            const emojis = reactionData.emoji.split(/\s+/).filter(e => e.trim() !== '');
            for (const emj of emojis) {
                await message.react(emj).catch(err => console.error(`Error reacting with ${emj}`, err.message));
            }
        }
    } catch (error) {
        console.error('Error fetching reaction config', error);
    }

    // Separator (runtime)
    try {
        const separatorData = await db.getSeparator(message.channel.id);
        if (separatorData && separatorData.separator_url) {
            const url = separatorData.separator_url;
            let separatorMessage;

            const isText = message.channel.isTextBased && message.channel.isTextBased();

            if (/^https?:\/\//i.test(url)) {
                if (isText) {
                    separatorMessage = await message.channel.send({ files: [url] });
                } else {
                    const embed = new EmbedBuilder()
                        .setColor('#2b2d31')
                        .setImage(url);
                    separatorMessage = await client.rest.post(`/channels/${message.channel.id}/messages`, {
                        body: { embeds: [embed.toJSON()] }
                    });
                }
            } else if (fs.existsSync(path.join(__dirname, url)) && isText) {
                separatorMessage = await message.channel.send({ files: [path.join(__dirname, url)] });
            } else if (isText) {
                separatorMessage = await message.channel.send({ content: url });
            } else {
                separatorMessage = await client.rest.post(`/channels/${message.channel.id}/messages`, {
                    body: { content: url }
                });
            }

            await db.setLastSeparatorMessage(message.channel.id, separatorMessage.id);
        }
    } catch (error) {
        console.error('Error handling separator', error);
    }
});

client.login(process.env.DISCORD_TOKEN);