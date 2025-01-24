
const setupMediaWebSocketServer = (mediaServer) => {
    mediaServer.on("connection", (ws, req) => {
        console.log("Media server connection established");
        console.log("Connection URL:", req.url);
        
        const path = req.url.replace("/", "");
        console.log(`Client connected to media channel: ${path}`);

        ws.on("message", async (data) => {
            try {
                const message = JSON.parse(data);
                console.log("Received message on media channel:", message);

                if (message.msg_type === "DATA_HAND_SHAKE_REQ") {
                    console.log("Processing DATA_HAND_SHAKE_REQ on media channel");
                    handleDataHandshake(ws, message, path);
                }
            } catch (error) {
                console.error("Error processing message on media channel:", error);
            }
        });

        ws.on("close", () => {
            console.log("Media connection closed for channel:", path);
        });
    });
};

module.exports = { setupMediaWebSocketServer };
