const WebSocket = require("ws");
const express = require("express");
const fs = require('fs');
const path = require('path');

const HANDSHAKE_PORT = 9092;
const MEDIA_STREAM_PORT = 8081;

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
    isHandshakeServerActive = true;
});

mediaHttpServer.listen(MEDIA_STREAM_PORT, "0.0.0.0", () => {
    console.log(`Media server running on port ${MEDIA_STREAM_PORT}`);
    mediaServer = new WebSocket.Server({ server: mediaHttpServer });
    setupMediaWebSocketServer(mediaServer);
});

// Setup WebSocket servers
const wss = new WebSocket.Server({ server: handshakeServer });

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
            console.log('Signaling message received:', message);
        });
    });
}

// Set up signaling
setupSignalingHandshake(wss);

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