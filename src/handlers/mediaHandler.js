
const { handleDataHandshake } = require('./dataHandler');
const { clearAllIntervals } = require('../utils/mediaUtils');

function setupMediaWebSocketServer(wss) {
    wss.on("connection", (ws, req) => {
        console.log("Media server connection established");
        
        const path = req.url.replace("/", "");
        console.log(`Client connected to media channel: ${path}`);

        ws.on("message", async (data) => {
            try {
                const message = JSON.parse(data);
                if (message.msg_type === "DATA_HAND_SHAKE_REQ") {
                    handleDataHandshake(ws, message, path);
                }
            } catch (error) {
                console.error("Error processing message on media channel:", error);
            }
        });

        ws.on("close", () => {
            console.log("Media connection closed for channel:", path);
            clearAllIntervals(ws);
        });
    });
}

module.exports = { setupMediaWebSocketServer };
