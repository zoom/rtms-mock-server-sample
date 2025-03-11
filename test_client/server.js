const express = require('express');
const crypto = require('crypto');
const WebSocket = require('ws');

const app = express();
const PORT = 8000;

// Middleware to parse incoming JSON payloads
app.use(express.json());

// Configuration - Replace with actual values, test values can be found in data/rtms_credentials.json
const ZOOM_SECRET_TOKEN = 'DyBoLm8OZoJT2Pi3-kY2px'; // Webhook secret for validation 
const CLIENT_ID = 'XkWfgHHASGOQC9b95AkIxB'; // Client ID for RTMS application, visit marketplace.zoom.us to get this
const CLIENT_SECRET = 'YZnKVUufg7N18Oej6gHHqNWc7CG5jQ6N'; // Secret key for generating HMAC signatures, visit marketplace.zoom to get this

// Track active connections
const activeConnections = new Map();

/**
 * Function to generate HMAC signature
 * 
 * @param {string} clientId - The client ID of the RTMS application
 * @param {string} meetingUuid - The UUID of the Zoom meeting
 * @param {string} streamId - The RTMS stream ID
 * @param {string} secret - The secret key used for signing
 * @returns {string} HMAC SHA256 signature
 */
function generateSignature(clientId, meetingUuid, streamId, secret) {
    const message = `${clientId},${meetingUuid},${streamId}`;
    return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * Webhook endpoint to receive events from Zoom
 */
app.post('/', (req, res) => {
    // Log incoming request headers
    console.log('Incoming Headers:', req.headers);
    
    // Log incoming request body
    console.log('Incoming Request Body:', req.body);

    const { event, payload } = req.body;

    // Handle Zoom Webhook validation
    if (event === 'endpoint.url_validation' && payload?.plainToken) {
        console.log('URL validation request received:', {
            event,
            plainToken: payload.plainToken
        });

        const hashForValidate = crypto.createHmac('sha256', ZOOM_SECRET_TOKEN)
            .update(payload.plainToken)
            .digest('hex');
            
        const response = {
            plainToken: payload.plainToken,
            encryptedToken: hashForValidate
        };
        
        console.log('Sending URL validation response:', response);
        return res.json(response);
    }

    // Handle RTMS start event
    if (event === 'meeting.rtms.started') {
        console.log('RTMS Start Event received');
        console.log('Full request body:', JSON.stringify(req.body, null, 2));
        
        const { meeting_uuid, rtms_stream_id, server_urls } = payload;
        
        console.log('Extracted connection details:', {
            meeting_uuid,
            rtms_stream_id,
            server_urls
        });
        
        console.log('Opening signaling connections...');
        connectToRTMSWebSocket(CLIENT_ID, meeting_uuid, rtms_stream_id, server_urls);

        console.log('Sending data through websockets..');
    }

    res.sendStatus(200);
});

/**
 * Connects to the RTMS WebSocket server
 */
function connectToRTMSWebSocket(clientId, meetingUuid, streamId, serverUrls) {
    console.log('Connection Parameters:', {
        clientId,
        meetingUuid,
        streamId,
        serverUrls
    });

    const connectionId = `${meetingUuid}_${streamId}_signaling`;
    
    // Close existing connection if any
    if (activeConnections.has(connectionId)) {
        console.log('Closing existing connection for:', connectionId);
        activeConnections.get(connectionId).close();
        activeConnections.delete(connectionId);
    }

    try {
        console.log('Creating new WebSocket connection to:', serverUrls);
        const ws = new WebSocket(serverUrls, { rejectUnauthorized: false });
        activeConnections.set(connectionId, ws);

        // Keep track of last keep-alive response
        let lastKeepAliveResponse = Date.now();
        
        // Set up keep-alive check interval
        const keepAliveInterval = setInterval(() => {
            console.log('Checking keep-alive status...', {
                lastResponse: new Date(lastKeepAliveResponse).toISOString(),
                timeSinceLastResponse: Date.now() - lastKeepAliveResponse
            });
            
            if (Date.now() - lastKeepAliveResponse > 30000) {
                console.log('Keep-alive timeout detected, closing connection');
                clearInterval(keepAliveInterval);
                ws.close();
                activeConnections.delete(connectionId);
            }
        }, 10000);

        ws.on("open", () => {
            console.log('WebSocket connection established successfully');
            const signature = generateSignature(clientId, meetingUuid, streamId, CLIENT_SECRET);
            const handshakeMessage = {
                msg_type: "SIGNALING_HAND_SHAKE_REQ",
                protocol_version: 1,
                meeting_uuid: meetingUuid,
                rtms_stream_id: streamId,
                signature: signature
            };
            console.log('Sending handshake message:', handshakeMessage);
            ws.send(JSON.stringify(handshakeMessage));
        });

        ws.on("message", (data) => {
            console.log('Raw message:', data.toString());
            const message = JSON.parse(data);
            console.log('Parsed message:', message);
            
            switch (message.msg_type) {
                case "SIGNALING_HAND_SHAKE_RESP":
                    console.log('Handshake response received:', message);
                    if (message.status_code === "STATUS_OK") {
                        const mediaServerUrl = message.media_server.server_urls.video;
                        console.log('Connecting to media server at:', mediaServerUrl);
                        connectToMediaWebSocket(mediaServerUrl, clientId, meetingUuid, streamId);
                    } else {
                        console.error('Handshake failed:', message);
                    }
                    break;
                case "KEEP_ALIVE_REQ":
                    console.log('Received keep-alive request');
                    lastKeepAliveResponse = Date.now();
                    const keepAliveResponse = {
                        msg_type: "KEEP_ALIVE_RESP",
                        timestamp: Date.now()
                    };
                    console.log('Sending keep-alive response:', keepAliveResponse);
                    ws.send(JSON.stringify(keepAliveResponse));
                    break;
                case "STREAM_STATE_UPDATE":
                    console.log('Stream state update received:', message);
                    if (message.state === "TERMINATED") {
                        console.log('Stream terminated, closing connection');
                        clearInterval(keepAliveInterval);
                        ws.close();
                        activeConnections.delete(connectionId);
                    }
                    break;
                default:
                    console.log('Unhandled message type:', message.msg_type);
            }
        });

        ws.on("close", () => {
            console.log('WebSocket connection closed for:', connectionId);
            clearInterval(keepAliveInterval);
            activeConnections.delete(connectionId);
        });

        ws.on("error", (error) => {
            console.error('WebSocket connection error:', error);
            clearInterval(keepAliveInterval);
        });

    } catch (error) {
        console.error('Error establishing WebSocket connection:', error);
    }
}

/**
 * Connects to the Media WebSocket server
 * 
 * @param {string} endpoint - WebSocket URL for media server
 * @param {string} clientId - The client ID
 * @param {string} meetingUuid - The meeting UUID
 * @param {string} streamId - The RTMS stream ID
 */
function connectToMediaWebSocket(endpoint, clientId, meetingUuid, streamId) {
    const connectionId = `${meetingUuid}_${streamId}_media`;
    
    // Close existing media connection if any
    if (activeConnections.has(connectionId)) {
        activeConnections.get(connectionId).close();
        activeConnections.delete(connectionId);
    }

    const mediaWs = new WebSocket(endpoint, { rejectUnauthorized: false });
    activeConnections.set(connectionId, mediaWs);

    mediaWs.on("open", () => {
        const mediaSignature = generateSignature(clientId, meetingUuid, streamId, CLIENT_SECRET);
        const dataHandshakeMessage = {
            msg_type: "DATA_HAND_SHAKE_REQ",
            protocol_version: 1,
            meeting_uuid: meetingUuid,
            rtms_stream_id: streamId,
            signature: mediaSignature,
            payload_encryption: false
        };
        mediaWs.send(JSON.stringify(dataHandshakeMessage));
    });

    mediaWs.on("message", (data) => {
        const message = JSON.parse(data);
        // Handle media data here
        console.log("Received media data:", message);
    });

    mediaWs.on("close", () => {
        activeConnections.delete(connectionId);
    });
}

// Start the Express server
app.listen(PORT, () => {
    console.log(`Zoom Webhook listening on port ${PORT}`);
});

// Clean up connections on exit
process.on("SIGINT", () => {
    for (const ws of activeConnections.values()) {
        ws.close();
    }
    process.exit(0);
});