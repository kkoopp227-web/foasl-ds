const mongoose = require('mongoose');

// Connect to MongoDB
if (!process.env.MONGO_URI) {
    console.error('Error: MONGO_URI is not set in environment variables!');
} else {
    mongoose.connect(process.env.MONGO_URI).then(() => {
        console.log('Connected to MongoDB database.');
    }).catch((err) => {
        console.error('Error connecting to MongoDB:', err.message);
    });
}

// Define Schemas and Models
const SeparatorSchema = new mongoose.Schema({
    channel_id: { type: String, required: true, unique: true },
    separator_url: String,
    last_message_id: String
});

const ReactionSchema = new mongoose.Schema({
    channel_id: { type: String, required: true, unique: true },
    emoji: String
});

const AutoDeleteSchema = new mongoose.Schema({
    channel_id: { type: String, required: true, unique: true },
    duration_minutes: { type: Number, required: true }
});

const Separator = mongoose.model('Separator', SeparatorSchema);
const Reaction = mongoose.model('Reaction', ReactionSchema);
const AutoDelete = mongoose.model('AutoDelete', AutoDeleteSchema);

const GrantPermSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, default: 'default' },
    role_ids: [String]
});
const GrantPerm = mongoose.model('GrantPerm', GrantPermSchema);

const ColorRolesSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, default: 'default' },
    role_ids: [String],
    channel_id: String
});
const ColorRoles = mongoose.model('ColorRoles', ColorRolesSchema);

// Helper functions for Separators
async function getSeparator(channelId) {
    return await Separator.findOne({ channel_id: channelId });
}

async function setSeparator(channelId, separatorUrl) {
    await Separator.findOneAndUpdate(
        { channel_id: channelId },
        { separator_url: separatorUrl },
        { upsert: true, new: true }
    );
}

async function removeSeparator(channelId) {
    await Separator.deleteOne({ channel_id: channelId });
}

async function setLastSeparatorMessage(channelId, messageId) {
    await Separator.updateOne(
        { channel_id: channelId },
        { last_message_id: messageId }
    );
}

// Helper functions for Reactions
async function getReaction(channelId) {
    return await Reaction.findOne({ channel_id: channelId });
}

async function setReaction(channelId, emoji) {
    await Reaction.findOneAndUpdate(
        { channel_id: channelId },
        { emoji: emoji },
        { upsert: true, new: true }
    );
}

async function removeReaction(channelId) {
    await Reaction.deleteOne({ channel_id: channelId });
}

// Helper functions for Auto Delete
async function getAutoDelete(channelId) {
    return await AutoDelete.findOne({ channel_id: channelId });
}

async function getAllAutoDeletes() {
    return await AutoDelete.find({});
}

async function setAutoDelete(channelId, durationMinutes) {
    await AutoDelete.findOneAndUpdate(
        { channel_id: channelId },
        { duration_minutes: durationMinutes },
        { upsert: true, new: true }
    );
}

async function removeAutoDelete(channelId) {
    await AutoDelete.deleteOne({ channel_id: channelId });
}

// Helper functions for Grant Permissions
async function getGrantRoles() {
    const doc = await GrantPerm.findOne({ key: 'default' });
    return doc ? doc.role_ids : [];
}

async function setGrantRoles(roleIds) {
    await GrantPerm.findOneAndUpdate(
        { key: 'default' },
        { role_ids: roleIds },
        { upsert: true, new: true }
    );
}

// Helper functions for Color Roles
async function getColorRoles() {
    return await ColorRoles.findOne({ key: 'default' });
}

async function setColorRoles(roleIds, channelId) {
    await ColorRoles.findOneAndUpdate(
        { key: 'default' },
        { role_ids: roleIds, channel_id: channelId },
        { upsert: true, new: true }
    );
}

module.exports = {
    getSeparator,
    setSeparator,
    removeSeparator,
    setLastSeparatorMessage,
    getReaction,
    setReaction,
    removeReaction,
    getAutoDelete,
    getAllAutoDeletes,
    setAutoDelete,
    removeAutoDelete,
    getGrantRoles,
    setGrantRoles,
    getColorRoles,
    setColorRoles
};
