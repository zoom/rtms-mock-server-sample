const express = require('express');
const crypto = require('crypto');
const WebSocket = require('ws');

const app = express();
const PORT = 8000;

// Middleware to parse incoming JSON payloads
app.use(express.json());

// Configuration - Replace with actual values
const ZOOM_SECRET_TOKEN = 'DyBoLm8OZoJT2Pi3-kY2px'; // Webhook secret for validation
const CLIENT_SECRET = 'YZnKVUufg7N18Oej6gHHqNWc7CG5jQ6N'; // Secret key for generating HMAC signatures

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
    console.log('Received request:', JSON.stringify(req.body, null, 2));

    const { event, payload } = req.body;

    // Handle Zoom Webhook Endpoint Validation
    if (event === 'endpoint.url_validation' && payload?.plainToken) {
        console.log('Processing Zoom endpoint validation...');
        const hashForValidate = crypto.createHmac('sha256', ZOOM_SECRET_TOKEN)
            .update(payload.plainToken)
            .digest('hex');

        console.log(`Validation response:`, {
            plainToken: payload.plainToken,
            encryptedToken: hashForValidate
        });

        return res.json({
            plainToken: payload.plainToken,
            encryptedToken: hashForValidate
        });
    }

    // Handle RTMS Event when a meeting starts streaming
    if (payload?.event === 'meeting.rtms.started' && payload?.payload?.object) {
        console.log('Processing RTMS Event: meeting.rtms.started');

        try {
            const {
                clientId,
                payload: {
                    event: rtmsEvent, // Extract event name
                    payload: {
                        operator_id,
                        object: { meeting_uuid, rtms_stream_id, server_urls }
                    }
                }
            } = req.body;

            console.log('Extracted RTMS Data:', {
                rtmsEvent,
                clientId,
                meeting_uuid,
                rtms_stream_id,
                server_urls
            });

            // Establish WebSocket connection with RTMS signaling server
            connectToRTMSWebSocket(clientId, meeting_uuid, rtms_stream_id, server_urls);
        } catch (error) {
            console.error('Error processing RTMS event:', error);
        }
    } 
    // Log other Zoom events for debugging
    else if (event) {
        console.log(`Processing Zoom event: ${event}`);
    } 
    // Handle unknown event types
    else {
        console.log("Received an event but couldn't determine the type.");
    }

    res.sendStatus(200);
});

// Add a map to track active connections
const activeConnections = new Map();

/**
 * Connects to the RTMS signaling WebSocket server
 * 
 * @param {string} clientId - The client ID
 * @param {string} meetingUuid - The meeting UUID
 * @param {string} streamId - The RTMS stream ID
 * @param {string} serverUrl - WebSocket URL for signaling server
 */
function connectToRTMSWebSocket(clientId, meetingUuid, streamId, serverUrl) {
    const connectionId = `${meetingUuid}_${streamId}`;

    // Add a small delay before establishing new connections
    // This helps prevent race conditions with server-side cleanup
    setTimeout(() => {
        // Close existing connection if it exists
        if (activeConnections.has(connectionId)) {
            const existingWs = activeConnections.get(connectionId);
            existingWs.terminate();
            activeConnections.delete(connectionId);
            console.log(`Closed existing connection for ${connectionId}`);
        }

        console.log(`Connecting to RTMS WebSocket server: ${serverUrl}`);
        const ws = new WebSocket(serverUrl, { rejectUnauthorized: false });
        
        activeConnections.set(connectionId, ws);

        // Set a timeout to prevent hanging if the connection is unresponsive
        const connectionTimeout = setTimeout(() => {
            console.error('Connection to WebSocket server timed out.');
            process.exit(1);
        }, 10000); // 10 seconds timeout

        ws.on("open", () => {
            clearTimeout(connectionTimeout);
            console.log("Connected to WebSocket server");

            // Periodically log connection status
            const connectionCheckInterval = setInterval(() => {
                console.log("Still connected...");
            }, 20000);

            // Generate authentication signature
            const signature = generateSignature(clientId, meetingUuid, streamId, CLIENT_SECRET);

            // Prepare handshake message for signaling server
            const handshakeMessage = {
                msg_type: "SIGNALING_HAND_SHAKE_REQ",
                protocol_version: 1,
                meeting_uuid: meetingUuid,
                rtms_stream_id: streamId,
                signature: signature
            };

            console.log("Sending handshake message:", JSON.stringify(handshakeMessage, null, 2));
            ws.send(JSON.stringify(handshakeMessage));

            // Handle WebSocket closure
            ws.on("close", (code, reason) => {
                clearInterval(connectionCheckInterval);
                console.log(`Connection ${connectionId} closed:`, code, reason.toString());
                cleanupConnections(meetingUuid, streamId);
            });
        });

        // Listen for messages from RTMS signaling server
        ws.on("message", (data) => {
            try {
                const message = JSON.parse(data);
                console.log("Received message from RTMS server:", JSON.stringify(message, null, 2));

                // Handle stream termination
                if (message.msg_type === "STREAM_STATE_UPDATE" && message.state === "TERMINATED") {
                    console.log(`Stream terminated for ${connectionId}. Reason: ${message.reason}`);
                    // Clean up all related connections
                    cleanupConnections(meetingUuid, streamId);
                    return;
                }

                // Handle handshake response
                if (message.msg_type === "SIGNALING_HAND_SHAKE_RESP") {
                    if (message.status_code === "STATUS_OK") {
                        const mediaServerUrls = message.media_server.server_urls;
                        console.log("Media server URLs received:", mediaServerUrls);
                        connectToMediaWebSocket(mediaServerUrls.all, clientId, meetingUuid, streamId);
                    } else if (message.status_code === "STATUS_ERROR") {
                        console.error("Error from signaling server:", message.reason);
                        // If we get an initialization error, clean up and retry after delay
                        if (message.reason === "Failed to initialize media server") {
                            cleanupConnections(meetingUuid, streamId);
                            setTimeout(() => {
                                console.log("Retrying connection after media server initialization failure...");
                                connectToRTMSWebSocket(clientId, meetingUuid, streamId, serverUrl);
                            }, 5000); // 5 second delay before retry
                        }
                    }
                }
            } catch (error) {
                console.error("Error parsing RTMS server message:", error);
            }
        });

        ws.on("error", (error) => {
            console.error("RTMS WebSocket error:", error);
            cleanupConnections(meetingUuid, streamId);
        });
    }, 1000); // 1 second delay before establishing new connections
}

// Helper function to clean up all connections for a meeting/stream
function cleanupConnections(meetingUuid, streamId) {
    const connectionIds = [
        `${meetingUuid}_${streamId}`,
        `${meetingUuid}_${streamId}_media`
    ];

    for (const id of connectionIds) {
        if (activeConnections.has(id)) {
            const ws = activeConnections.get(id);
            if (ws.keepAliveInterval) {
                clearInterval(ws.keepAliveInterval);
            }
            ws.terminate();
            activeConnections.delete(id);
            console.log(`Cleaned up connection: ${id}`);
        }
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

    // Close existing media connection if it exists
    if (activeConnections.has(connectionId)) {
        const existingWs = activeConnections.get(connectionId);
        existingWs.terminate();
        activeConnections.delete(connectionId);
        console.log(`Closed existing media connection for ${connectionId}`);
    }

    console.log(`Attempting to connect to Media WebSocket server: ${endpoint}`);
    console.log('Full connection details:', { endpoint, clientId, meetingUuid, streamId });

    // Add more robust error handling
    if (!endpoint) {
      console.error('No media server endpoint provided');
      return;
    }

    const mediaWs = new WebSocket(endpoint, { rejectUnauthorized: false });
    
    activeConnections.set(connectionId, mediaWs);

    mediaWs.on("open", () => {
        console.log("Connected to Media WebSocket server:", endpoint);

        // Periodically log connection status
        const mediaConnectionCheckInterval = setInterval(() => {
            console.log("Still connected...");
        }, 20000);

        // Generate authentication signature
        const mediaSignature = generateSignature(clientId, meetingUuid, streamId, CLIENT_SECRET);

        // Prepare handshake message for media server
        const dataHandshakeMessage = {
            msg_type: "DATA_HAND_SHAKE_REQ",
            protocol_version: 1,
            meeting_uuid: meetingUuid,
            rtms_stream_id: streamId,
            signature: mediaSignature,
            payload_encryption: false
        };

        console.log("Sending data handshake message:", JSON.stringify(dataHandshakeMessage, null, 2));
        mediaWs.send(JSON.stringify(dataHandshakeMessage));

        // Handle WebSocket closure
        mediaWs.on("close", (code, reason) => {
            clearInterval(mediaConnectionCheckInterval);
            console.log(`Media connection ${connectionId} closed:`, code, reason.toString());
            cleanupConnections(meetingUuid, streamId);
        });

        // Listen for media data
        mediaWs.on("message", (data) => {
            try {
                const message = JSON.parse(data);
                console.log("Parsed message from media server:", JSON.stringify(message, null, 2));
            } catch (error) {
                console.error("Error parsing media message:", error);
            }
        });

        mediaWs.on("error", (error) => {
            console.error(`Media WebSocket error while connecting to ${endpoint}:`, error);
            cleanupConnections(meetingUuid, streamId);
        });
    });
}

// Start the Express server
app.listen(PORT, () => {
    console.log(`Zoom Webhook listening on port ${PORT}`);
});

// Add proper cleanup on process exit
process.on("SIGINT", () => {
    console.log("Closing WebSocket connections...");
    for (const [connectionId, ws] of activeConnections.entries()) {
        console.log(`Closing connection: ${connectionId}`);
        ws.terminate();
    }
    activeConnections.clear();
    process.exit(0);
});

// Add cleanup for unexpected errors
process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error);
    for (const [connectionId, ws] of activeConnections.entries()) {
        console.log(`Closing connection: ${connectionId}`);
        ws.terminate();
    }
    activeConnections.clear();
    process.exit(1);
});
