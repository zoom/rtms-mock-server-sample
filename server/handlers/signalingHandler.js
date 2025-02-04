const WebSocketUtils = require('../utils/wsUtils');
const CredentialsManager = require('../utils/credentialsManager');
const CONFIG = require('../config/serverConfig');
const crypto = require('crypto');

class SignalingHandler {
    static handleMessage(ws, data) {
        try {
            const message = JSON.parse(data);
            WebSocketUtils.logWebSocketMessage("RECEIVED", message.msg_type, message, "signaling");

            if (message.msg_type === "SIGNALING_HAND_SHAKE_REQ") {
                this.handleSignalingHandshake(ws, message);
            }
        } catch (error) {
            console.error("Error processing message:", error);
        }
    }

    static handleSignalingHandshake(ws, message) {
        if (!this.validateHandshakeMessage(message, ws)) {
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

    static validateHandshakeMessage(message, ws) {
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
}

module.exports = SignalingHandler; 