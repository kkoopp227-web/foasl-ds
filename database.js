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

const Separator = mongoose.model('Separator', SeparatorSchema);
const Reaction = mongoose.model('Reaction', ReactionSchema);

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

module.exports = {
    getSeparator,
    setSeparator,
    removeSeparator,
    setLastSeparatorMessage,
    getReaction,
    setReaction,
    removeReaction
};
