require('dotenv').config();
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(port, () => console.log(`Dummy server listening at http://localhost:${port}`));

const {
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes,
    ChannelSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType
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

// ---------- Interactive panel state (key: user id) ----------
const panels = new Map(); // userId -> { type, channels:Set, duration:number|null, src:string|null }

function panelEmbed(state) {
    const embed = new EmbedBuilder().setColor('#2b2d31');

    if (state.type === 'auto-delete') {
        embed.setTitle('إعداد الحذف التلقائي');
        embed.setDescription(
            '1- اختر الرومات من القائمة أدناه.\n' +
            '2- اضغط زر «المدة» واكتب الوقت بالدقائق.\n' +
            '3- اضغط «تشغيل» لتطبيق الإعداد.'
        );
    } else {
        embed.setTitle('إعداد الفاصل');
        embed.setDescription(
            '1- اختر الرومات من القائمة أدناه.\n' +
            '2- اضغط «تشغيل» لتطبيق الفاصل على الرومات المحددة.'
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
            .setPlaceholder('اختر الرومات الصوتية (ممكن أكثر من واحد)')
            .setChannelTypes([ChannelType.GuildVoice])
            .setMinValues(1)
            .setMaxValues(25)
    );
    const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('sep_apply').setLabel('تشغيل').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('sep_cancel').setLabel('إلغاء').setStyle(ButtonStyle.Danger)
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
        // Remove all existing slash commands
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        console.log('All slash commands removed.');
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
                if (!channel) continue;

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
    if (interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;

    // Channel selection updates
    if (interaction.isChannelSelectMenu()) {
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
                return interaction.reply({ content: 'اختر الرومات أولاً من القائمة.', ephemeral: true });
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

        return;
    }

    // Modal submit (duration)
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
        }
        return;
    }
});

// ---------- Prefix commands ----------
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content.trimStart().startsWith(PREFIX)) {
        const content = message.content.slice(PREFIX.length).trim();
        const args = content.split(/\s+/).filter(a => a !== '');
        const name = (args.shift() || '').toLowerCase();

        if (!isAdminChannel(message.channel.id)) {
            return message.reply('عذراً، لا يمكنك استخدام الأوامر إلا في الشات المخصص لها.');
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

            if (!src) {
                return message.reply(
                    'أرفق صورة الفاصل مع الأمر، أو ضع رابطها بعده.\n' +
                    'مثال: اكتب `-setup-separator` وأرفق الصورة في نفس الرسالة.'
                );
            }

            const isFullUrl = /^https?:\/\//i.test(src);
            const isExistingFile = fs.existsSync(path.join(__dirname, src));
            if (!isFullUrl && !isExistingFile) {
                return message.reply(
                    'القيمة المُدخلة ليست رابط صورة صحيح ولا ملف موجود في المشروع. ارفع الصورة مع الأمر أو ضع رابطاً كاملاً يبدأ بـ https://'
                );
            }

            await sendSeparatorPanel(message.channel, message.author.id, src);
            return;
        }

        return message.reply(
            'الأوامر المتاحة:\n' +
            `- \`${PREFIX}auto-delete\` → لوحة الحذف التلقائي (اختر الرومات + المدة + تشغيل)\n` +
            `- \`${PREFIX}setup-separator\` → أرفق صورة أو رابطاً، ثم اختر الرومات`
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
                const embed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setImage(url);
                if (isText) {
                    separatorMessage = await message.channel.send({ embeds: [embed] });
                } else {
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