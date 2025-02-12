const WebSocketUtils = require('../utils/wsUtils');
const CredentialsManager = require('../utils/credentialsManager');
const CONFIG = require('../config/serverConfig');
const crypto = require('crypto');

class SignalingHandler {
    static STOP_REASONS = [
        'STOP_BC_HOST_TRIGGERED',
        'STOP_BC_USER_TRIGGERED',
        'STOP_BC_USER_LEFT',
        'STOP_BC_USER_EJECTED',
        'STOP_BC_APP_DISABLED_BY_HOST',
        'STOP_BC_STREAM_CANCELED',
        'STOP_BC_STREAM_REVOKED',
        'STOP_BC_ALL_APPS_DISABLED'
    ];

    static getRandomStopReason() {
        const randomIndex = Math.floor(Math.random() * this.STOP_REASONS.length);
        return this.STOP_REASONS[randomIndex];
    }

    static handleMessage(ws, data) {
        try {
            const message = JSON.parse(data);
            
            // Add log for incoming signaling message
            this.emitSignalingLog('Received', message.msg_type, message);
            
            switch (message.msg_type) {
                case "SIGNALING_HAND_SHAKE_REQ":
                    this.handleHandshake(ws, message);
                    break;
                case "EVENT_SUBSCRIPTION":
                    this.handleEventSubscription(ws, message);
                    break;
                case "SESSION_STATE_UPDATE":
                    this.handleSessionStateUpdate(ws, message);
                    break;
                case "KEEP_ALIVE_RESP":
                    this.handleKeepAliveResponse(ws, message);
                    break;
                default:
                    console.log("Unknown signaling message type:", message.msg_type);
            }
        } catch (error) {
            this.emitSignalingLog('Error', 'Message Processing', { error: error.message });
        }
    }

    static handleHandshake(ws, message) {
        this.emitSignalingLog('Info', 'Handshake Request Received', message);
        
        if (!this.validateHandshakeMessage(ws, message)) {
            this.emitSignalingLog('Failed', 'Handshake Validation Failed', message);
            return;
        }

        this.emitSignalingLog('Success', 'Handshake Validation Successful', message);
        
        try {
            // Initialize the media server if it doesn't exist or was previously closed
            if (!global.mediaServer || global.mediaServer.isClosed) {
                this.emitSignalingLog('Info', 'Initializing Media Server');
                try {
                    const MediaHandler = require('./mediaHandler');
                    const mediaHttpServer = require('../setup/serverSetup').setupMediaServer();
                    global.mediaServer = MediaHandler.setupMediaServer(mediaHttpServer);
                    
                    // Set up error handler for media server
                    global.mediaServer.on('error', (error) => {
                        this.emitSignalingLog('Error', 'Media Server Error', { error: error.message });
                    });

                    // Add a ready check
                    if (!global.mediaServer.isReady) {
                        throw new Error('Media server failed to initialize properly');
                    }
                } catch (initError) {
                    this.emitSignalingLog('Error', 'Media Server Initialization Failed', { error: initError.message });
                    WebSocketUtils.sendWebSocketResponse(ws, "SIGNALING_HAND_SHAKE_RESP", "STATUS_ERROR", "Failed to initialize media server");
                    return;
                }
            }
            
            const response = {
                media_server: {
                    server_urls: {
                        audio: `ws://${CONFIG.HOST}:${CONFIG.MEDIA_PORT}${CONFIG.ENDPOINTS.AUDIO}`,
                        video: `ws://${CONFIG.HOST}:${CONFIG.MEDIA_PORT}${CONFIG.ENDPOINTS.VIDEO}`,
                        transcript: `ws://${CONFIG.HOST}:${CONFIG.MEDIA_PORT}${CONFIG.ENDPOINTS.TRANSCRIPT}`,
                        all: `ws://${CONFIG.HOST}:${CONFIG.MEDIA_PORT}${CONFIG.ENDPOINTS.ALL}`,
                    },
                    srtp_keys: this.generateSRTPKeys(),
                }
            };

            // Store the websocket connection globally
            global.signalingWebsocket = ws;

            // Set up keep-alive handling
            ws.isAlive = true;
            ws.keepAliveInterval = setInterval(() => {
                if (!ws.isAlive) {
                    this.emitSignalingLog('Error', 'Keep-alive timeout');
                    clearInterval(ws.keepAliveInterval);
                    ws.terminate();
                    return;
                }
                ws.isAlive = false;
                WebSocketUtils.sendWebSocketResponse(ws, "KEEP_ALIVE_REQ", "STATUS_OK");
            }, 30000);

            this.emitSignalingLog('Info', 'Sending Handshake Response', response);
            WebSocketUtils.sendWebSocketResponse(ws, "SIGNALING_HAND_SHAKE_RESP", "STATUS_OK", null, response);
        } catch (error) {
            this.emitSignalingLog('Error', 'Handshake Failed', { error: error.message });
            WebSocketUtils.sendWebSocketResponse(ws, "SIGNALING_HAND_SHAKE_RESP", "STATUS_ERROR", "Failed to initialize media server");
        }
    }

    static validateHandshakeMessage(ws, message) {
        // Check protocol version
        if (message.protocol_version !== 1) {
            WebSocketUtils.sendWebSocketResponse(ws, "SIGNALING_HAND_SHAKE_RESP", "STATUS_INVALID_VERSION", "Unsupported protocol version");
            return false;
        }

        // Check required fields
        const { meeting_uuid, rtms_stream_id, signature } = message;
        if (!meeting_uuid || !rtms_stream_id || !signature) {
            WebSocketUtils.sendWebSocketResponse(ws, "SIGNALING_HAND_SHAKE_RESP", "STATUS_INVALID_MESSAGE", "Missing required fields");
            return false;
        }

        // Load credentials
        const credentials = CredentialsManager.loadCredentials();
        if (!credentials) {
            WebSocketUtils.sendWebSocketResponse(ws, "SIGNALING_HAND_SHAKE_RESP", "STATUS_UNAUTHORIZED", "Failed to load credentials");
            return false;
        }

        // Verify meeting_uuid and rtms_stream_id
        const streamInfo = credentials.stream_meeting_info.find(
            (info) => info.meeting_uuid === meeting_uuid && 
                      info.rtms_stream_id === rtms_stream_id
        );

        if (!streamInfo) {
            WebSocketUtils.sendWebSocketResponse(ws, "SIGNALING_HAND_SHAKE_RESP", "STATUS_UNAUTHORIZED", "Invalid meeting or stream ID");
            return false;
        }

        // Verify signature
        const matchingCred = credentials.auth_credentials.find((cred) => 
            CredentialsManager.validateSignature(
                signature,
                cred.client_id,
                meeting_uuid,
                rtms_stream_id,
                cred.client_secret
            )
        );

        if (!matchingCred) {
            WebSocketUtils.sendWebSocketResponse(ws, "SIGNALING_HAND_SHAKE_RESP", "STATUS_UNAUTHORIZED", "Invalid signature");
            return false;
        }

        // Store the validated credentials
        ws.validatedCredentials = matchingCred;

        // Add HMAC-SHA256 verification
        const clientSecret = matchingCred.client_secret;
        const clientId = matchingCred.client_id;
        const calculatedSignature = crypto.createHmac('sha256', clientSecret)
            .update(`${clientId},${meeting_uuid},${rtms_stream_id}`)
            .digest('hex');
        
        if (calculatedSignature !== signature) {
            WebSocketUtils.sendWebSocketResponse(ws, "SIGNALING_HAND_SHAKE_RESP", "STATUS_INVALID_SIGNATURE");
            return false;
        }

        return true;
    }

    static generateSRTPKeys() {
        return {
            audio: crypto.randomBytes(32).toString("hex"),
            video: crypto.randomBytes(32).toString("hex"),
            share: crypto.randomBytes(32).toString("hex"),
        };
    }

    static handleClose(ws) {
        this.emitSignalingLog('Event', 'Connection Closed');
        console.log("Handshake connection closed");
        
        // Only try to clear the interval if ws exists and has a keepAliveInterval
        if (ws && ws.keepAliveInterval) {
            clearInterval(ws.keepAliveInterval);
        }
        
        // Don't automatically close the media server on connection close
        // Only clear the signaling websocket if it matches the current one
        if (global.signalingWebsocket === ws) {
            global.signalingWebsocket = null;
        }
    }

    static handleError(error) {
        this.emitSignalingLog('Error', 'Connection Error', { error: error?.message });
        console.log("Handshake connection error");
        if (global.mediaServer) {
            global.mediaServer.close();
            global.mediaServer = null;
        }
        global.signalingWebsocket = null;
    }

    static handleEventSubscription(ws, message) {
        const { events } = message;
        ws.subscribedEvents = new Set();
        events.forEach(event => {
            if (event.subscribe) {
                ws.subscribedEvents.add(event.event_type);
            }
        });
        this.emitSignalingLog('Info', 'Event Subscription Updated', {
            subscribed_events: Array.from(ws.subscribedEvents)
        });
    }

    static handleSessionStateUpdate(ws, message) {
        const { state, rtms_session_id } = message;
        ws.sessionState = state;

        // If the state is "STOPPED", use a random stop reason
        if (state === "STOPPED") {
            const stopReason = this.getRandomStopReason();
            this.emitSignalingLog('Info', 'Session State Update - Stop', {
                state,
                rtms_session_id,
                stop_reason: stopReason
            });
            
            // Send stream termination message with random reason
            if (ws.readyState === 1) { // WebSocket.OPEN
                ws.send(JSON.stringify({
                    msg_type: "STREAM_STATE_UPDATE",
                    state: "TERMINATED",
                    reason: stopReason,
                    timestamp: Date.now()
                }));
            }
        } else {
            this.emitSignalingLog('Info', 'Session State Update', {
                state,
                rtms_session_id
            });
        }
        
        this.broadcastSessionState(rtms_session_id, state);
    }

    static broadcastSessionState(sessionId, state) {
        if (!global.signalingWebsocket) return;

        const stateMessage = {
            msg_type: "SESSION_STATE_UPDATE",
            rtms_session_id: sessionId,
            state: state,
            timestamp: Date.now()
        };

        global.signalingWebsocket.send(JSON.stringify(stateMessage));
    }

    static handleKeepAliveResponse(ws, message) {
        ws.isAlive = true;
        this.emitSignalingLog('Info', 'Keep-alive response received');
    }

    static emitSignalingLog(status, event, details = null) {
        if (global.logsWss) {
            global.logsWss.clients.forEach(client => {
                if (client.readyState === 1 && client.isLogsConnection) { // WebSocket.OPEN
                    client.send(JSON.stringify({
                        msg_type: 'SIGNALING_LOG',
                        content: {
                            status,
                            event,
                            details,
                            timestamp: Date.now()
                        }
                    }));
                }
            });
        }
    }
}

module.exports = SignalingHandler; 