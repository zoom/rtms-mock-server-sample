const { validateCredentials, loadCredentials } = require('../utils/authUtils');
const { generateSignature } = require('../utils/cryptoUtils');
const { clientSessions } = require('../utils/sessionStore');

const setupSignalingHandshake = (wss, mediaServer) => {
    wss.on("connection", (ws) => {
        console.log("New handshake connection established");

        ws.on("close", () => {
            console.log("Handshake connection closed");
            if (mediaServer) mediaServer.close();
        });

        ws.on("error", () => {
            console.log("Handshake connection error");
            if (mediaServer) mediaServer.close();
        });

        ws.on("message", async (data) => {
            try {
                const message = JSON.parse(data);
                console.log("Received message:", message);

                if (message.msg_type === "SIGNALING_HAND_SHAKE_REQ") {
                    handleSignalingHandshake(ws, message);
                }
            } catch (error) {
                console.error("Error processing message:", error);
            }
        });
    });
};

function handleSignalingHandshake(ws, message) {
    const { meeting_uuid, rtms_stream_id, signature, protocol_version } = message;

    if (protocol_version !== 1) {
        sendErrorResponse(ws, "STATUS_INVALID_VERSION");
        return;
    }

    if (!meeting_uuid || !rtms_stream_id || !signature) {
        sendErrorResponse(ws, "STATUS_INVALID_MESSAGE");
        return;
    }

    const credentials = loadCredentials();
    const matchingCred = credentials.find(cred =>
        cred.meeting_uuid === meeting_uuid &&
        cred.rtms_stream_id === rtms_stream_id
    );

    if (!matchingCred || !validateSignature(signature, matchingCred, meeting_uuid, rtms_stream_id)) {
        sendErrorResponse(ws, "STATUS_UNAUTHORIZED");
        return;
    }

    clientSessions.set(ws, {
        meeting_uuid,
        rtms_stream_id,
        handshakeCompleted: true
    });

    sendSuccessResponse(ws);
}

module.exports = { setupSignalingHandshake, handleSignalingHandshake };