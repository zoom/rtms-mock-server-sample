
const WebSocket = require("ws");
const express = require("express");
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Constants
const HANDSHAKE_PORT = 9092;
const MEDIA_STREAM_PORT = 8081;

// Express apps
const handshakeApp = express();
const mediaApp = express();

// Create HTTP servers
const handshakeServer = require("http").createServer(handshakeApp);
const mediaHttpServer = require("http").createServer(mediaApp);

// WebSocket server for handshake
const handshakeWss = new WebSocket.Server({ server: handshakeServer });
let mediaServer = null;

// Load credentials
function loadCredentials() {
    try {
        const data = fs.readFileSync(path.join(__dirname, '../data/rtms_credentials.json'), 'utf8');
        return JSON.parse(data).credentials;
    } catch (error) {
        console.error('Error loading credentials:', error);
        return [];
    }
}

function setupMediaWebSocketServer(wss) {
    wss.on('connection', (ws) => {
        console.log('Media client connected');
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                console.log('Media message received:', data);
            } catch (error) {
                console.error('Error parsing media message:', error);
            }
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
                
                if (data.msg_type === 'SIGNALING_HAND_SHAKE_REQ') {
                    const credentials = loadCredentials();
                    const { meeting_uuid, rtms_stream_id, signature } = data;
                    
                    // Basic validation
                    if (!meeting_uuid || !rtms_stream_id || !signature) {
                        ws.send(JSON.stringify({
                            msg_type: 'SIGNALING_HAND_SHAKE_RESP',
                            status_code: 'STATUS_INVALID_MESSAGE'
                        }));
                        return;
                    }

                    // Send success response
                    ws.send(JSON.stringify({
                        msg_type: 'SIGNALING_HAND_SHAKE_RESP',
                        status_code: 'STATUS_OK',
                        media_server: {
                            server_urls: {
                                audio: `wss://0.0.0.0:${MEDIA_STREAM_PORT}/audio`,
                                video: `wss://0.0.0.0:${MEDIA_STREAM_PORT}/video`
                            }
                        }
                    }));
                }
            } catch (error) {
                console.error('Error processing signaling message:', error);
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
