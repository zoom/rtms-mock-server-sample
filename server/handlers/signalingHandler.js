const CONFIG = require('../config/serverConfig');
const CredentialsManager = require('../utils/credentialsManager');

class SignalingHandler {
    static handleSignalingHandshake(ws, message, clientSessions) {
        const { client_id, meeting_uuid, rtms_stream_id, signature } = message;
        const credentials = CredentialsManager.loadCredentials();

        const matchingCred = credentials.auth_credentials.find(cred => 
            CredentialsManager.validateSignature(signature, cred.client_id, meeting_uuid, rtms_stream_id, cred.client_secret)
        );

        if (!matchingCred) {
            return this.sendUnauthorizedResponse(ws, "Invalid credentials");
        }

        clientSessions.set(ws, {
            meeting_uuid,
            rtms_stream_id,
            handshakeCompleted: true,
        });

        this.sendSuccessResponse(ws);
    }

    static sendUnauthorizedResponse(ws, reason) {
        ws.send(JSON.stringify({
            msg_type: "SIGNALING_HAND_SHAKE_RESP",
            protocol_version: 1,
            status_code: "STATUS_UNAUTHORIZED",
            reason,
        }));
    }

    static sendSuccessResponse(ws) {
        const response = {
            msg_type: "SIGNALING_HAND_SHAKE_RESP",
            protocol_version: 1,
            status_code: "STATUS_OK",
            media_server: {
                server_urls: {
                    audio: `ws://${CONFIG.HOST}:${CONFIG.MEDIA_PORT}${CONFIG.ENDPOINTS.AUDIO}`,
                    video: `ws://${CONFIG.HOST}:${CONFIG.MEDIA_PORT}${CONFIG.ENDPOINTS.VIDEO}`,
                    transcript: `ws://${CONFIG.HOST}:${CONFIG.MEDIA_PORT}${CONFIG.ENDPOINTS.TRANSCRIPT}`,
                    all: `ws://${CONFIG.HOST}:${CONFIG.MEDIA_PORT}${CONFIG.ENDPOINTS.ALL}`,
                },
                srtp_keys: CredentialsManager.generateSRTPKeys(),
            },
        };
        ws.send(JSON.stringify(response));
    }
}

module.exports = SignalingHandler; 