
const WebSocket = require("ws");
const express = require("express");
const { setupMediaWebSocketServer } = require('./handlers/mediaHandler');
const { setupSignalingHandshake } = require('./handlers/signalHandler');
const { HANDSHAKE_PORT, MEDIA_STREAM_PORT } = require('./constants');
const { initializePCMConversion } = require('./utils/mediaUtils');

// Express apps and WebSocket servers
const handshakeApp = express();
const mediaApp = express();
const mediaHttpServer = require("http").createServer(mediaApp);
let mediaServer = null;
let isHandshakeServerActive = false;
const handshakeServer = require("http").createServer(handshakeApp);

// Start both servers
handshakeServer.listen(HANDSHAKE_PORT, "0.0.0.0", () => {
    console.log(`Handshake server running on port ${HANDSHAKE_PORT}`);
});

mediaHttpServer.listen(MEDIA_STREAM_PORT, "0.0.0.0", () => {
    console.log(`Media server running on port ${MEDIA_STREAM_PORT}`);
    mediaServer = new WebSocket.Server({ server: mediaHttpServer });
    setupMediaWebSocketServer(mediaServer);
});

// Setup signaling WebSocket server
const wss = new WebSocket.Server({ noServer: true, clientTracking: true });
setupSignalingHandshake(wss, mediaServer);

// Handle WebSocket upgrade
handshakeServer.on("upgrade", (request, socket, head) => {
    if (request.url === "/signaling" || request.url === "/" || request.url === "") {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request);
        });
    } else if (request.url.match(/^\/(audio|video|transcript|all)/)) {
        if (mediaServer) {
            mediaServer.handleUpgrade(request, socket, head, (ws) => {
                mediaServer.emit("connection", ws, request);
            });
        } else {
            socket.destroy();
        }
    } else {
        socket.destroy();
    }
});

// HTTP routes
handshakeApp.get("/", (req, res) => res.send("RTMS Server is running"));
handshakeApp.get("/health", (req, res) => res.status(200).json({ status: "ok" }));
handshakeApp.get("/ws-health", (req, res) => {
    if (isHandshakeServerActive && mediaServer) {
        res.status(200).json({ status: "ok" });
    } else {
        res.status(503).json({ status: "error", message: "WebSocket servers not ready" });
    }
});

console.log("Starting WSS servers...");
