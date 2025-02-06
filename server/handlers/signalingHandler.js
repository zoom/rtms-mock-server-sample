const WebSocketUtils = require('../utils/wsUtils');
const CredentialsManager = require('../utils/credentialsManager');
const CONFIG = require('../config/serverConfig');
const crypto = require('crypto');

class SignalingHandler {
    static handleMessage(ws, data) {
        try {
            const message = JSON.parse(data);
            
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
            console.error("Error processing signaling message:", error);
        }
    }

    static handleHandshake(ws, message) {
        if (!this.validateHandshakeMessage(ws, message)) {
            return;
        }

        // Success response
        WebSocketUtils.sendWebSocketResponse(ws, "SIGNALING_HAND_SHAKE_RESP", "STATUS_OK", null, {
            media_server: {
                server_urls: {
                    audio: `ws://${CONFIG.HOST}:${CONFIG.MEDIA_PORT}${CONFIG.ENDPOINTS.AUDIO}`,
                    video: `ws://${CONFIG.HOST}:${CONFIG.MEDIA_PORT}${CONFIG.ENDPOINTS.VIDEO}`,
                    transcript: `ws://${CONFIG.HOST}:${CONFIG.MEDIA_PORT}${CONFIG.ENDPOINTS.TRANSCRIPT}`,
                    all: `ws://${CONFIG.HOST}:${CONFIG.MEDIA_PORT}${CONFIG.ENDPOINTS.ALL}`,
                },
                srtp_keys: this.generateSRTPKeys(),
            }
        });
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

    static handleClose() {
        console.log("Handshake connection closed");
        if (global.mediaServer) {
            global.mediaServer.close();
            global.mediaServer = null;
        }
        global.signalingWebsocket = null;
    }

    static handleError() {
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
        console.log(`Updated event subscriptions: ${Array.from(ws.subscribedEvents)}`);
    }

    static handleSessionStateUpdate(ws, message) {
        const { state, rtms_session_id } = message;
        ws.sessionState = state;
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
}

module.exports = SignalingHandler; 