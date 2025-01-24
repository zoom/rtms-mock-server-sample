
const WebSocket = require("ws");
const express = require("express");
const fs = require('fs');
const path = require('path');

const HANDSHAKE_PORT = 9092;
const MEDIA_STREAM_PORT = 8081;

// Express apps
const handshakeApp = express();
const mediaApp = express();

// Create HTTP servers
const handshakeServer = require("http").createServer(handshakeApp);
const mediaHttpServer = require("http").createServer(mediaApp);

// WebSocket servers
const handshakeWss = new WebSocket.Server({ server: handshakeServer });
let mediaServer = null;

function setupMediaWebSocketServer(wss) {
    wss.on('connection', (ws) => {
        console.log('Media client connected');
        ws.on('message', (message) => {
            console.log('Media message received:', message);
        });
    });
}

function setupSignalingHandshake(wss) {
    wss.on('connection', (ws) => {
        console.log('Signaling client connected');
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                console.log('Signaling message received:', data);
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        });
    });
}

// Start servers
handshakeServer.listen(HANDSHAKE_PORT, "0.0.0.0", () => {
    console.log(`Handshake server running on port ${HANDSHAKE_PORT}`);
});

mediaHttpServer.listen(MEDIA_STREAM_PORT, "0.0.0.0", () => {
    console.log(`Media server running on port ${MEDIA_STREAM_PORT}`);
    mediaServer = new WebSocket.Server({ server: mediaHttpServer });
    setupMediaWebSocketServer(mediaServer);
});

// Setup signaling
setupSignalingHandshake(handshakeWss);

// HTTP routes
handshakeApp.get("/", (req, res) => res.send("RTMS Server is running"));
handshakeApp.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

console.log("Starting WSS servers...");
