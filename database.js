const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        // Create tables if they don't exist
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS separators (
                channel_id TEXT PRIMARY KEY,
                separator_url TEXT,
                last_message_id TEXT
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS reactions (
                channel_id TEXT PRIMARY KEY,
                emoji TEXT
            )`);
        });
    }
});

// Helper functions for Separators
function getSeparator(channelId) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT separator_url, last_message_id FROM separators WHERE channel_id = ?`, [channelId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function setSeparator(channelId, separatorUrl) {
    return new Promise((resolve, reject) => {
        db.run(`INSERT INTO separators (channel_id, separator_url) VALUES (?, ?)
                ON CONFLICT(channel_id) DO UPDATE SET separator_url = excluded.separator_url`, 
                [channelId, separatorUrl], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function removeSeparator(channelId) {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM separators WHERE channel_id = ?`, [channelId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function setLastSeparatorMessage(channelId, messageId) {
    return new Promise((resolve, reject) => {
        db.run(`UPDATE separators SET last_message_id = ? WHERE channel_id = ?`, [messageId, channelId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// Helper functions for Reactions
function getReaction(channelId) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT emoji FROM reactions WHERE channel_id = ?`, [channelId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function setReaction(channelId, emoji) {
    return new Promise((resolve, reject) => {
        db.run(`INSERT INTO reactions (channel_id, emoji) VALUES (?, ?)
                ON CONFLICT(channel_id) DO UPDATE SET emoji = excluded.emoji`, 
                [channelId, emoji], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function removeReaction(channelId) {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM reactions WHERE channel_id = ?`, [channelId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
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
