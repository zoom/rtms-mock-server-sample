class MediaHandler {
    static handleMediaMessage(message, mediaServer, signalingWebsocket) {
        if (message.msg_type === "SESSION_STATE_UPDATE") {
            this.handleSessionStateUpdate(message, mediaServer, signalingWebsocket);
        } else if (this.isMediaDataMessage(message)) {
            this.broadcastMediaData(message, mediaServer);
        }
    }

    static isMediaDataMessage(message) {
        return ["MEDIA_DATA_VIDEO", "MEDIA_DATA_AUDIO", "MEDIA_DATA_TRANSCRIPT"].includes(message.msg_type);
    }

    static handleSessionStateUpdate(message, mediaServer, signalingWebsocket) {
        if (signalingWebsocket?.readyState === WebSocket.OPEN) {
            this.relaySessionState(message, signalingWebsocket);
        }

        if (message.state === "STOPPED") {
            this.handleSessionStop(mediaServer, signalingWebsocket);
        }
    }

    static relaySessionState(message, signalingWebsocket) {
        signalingWebsocket.send(JSON.stringify({
            msg_type: "SESSION_STATE_UPDATE",
            session_id: message.rmts_session_id,
            state: message.state,
            stop_reason: message.stop_reason,
            timestamp: message.timestamp || Date.now()
        }));
    }

    static handleSessionStop(mediaServer, signalingWebsocket) {
        mediaServer.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    msg_type: "STREAM_STATE_UPDATE",
                    state: "TERMINATED",
                    reason: "STOP_BC_MEETING_ENDED",
                    timestamp: Date.now()
                }));
                client.close();
            }
        });

        if (signalingWebsocket?.readyState === WebSocket.OPEN) {
            signalingWebsocket.close();
        }
    }

    static broadcastMediaData(message, mediaServer) {
        mediaServer.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                const clientPath = client.pathname?.replace('/', '') || 'all';
                if (this.shouldSendToClient(clientPath, message.msg_type)) {
                    client.send(JSON.stringify(message));
                }
            }
        });
    }

    static shouldSendToClient(clientPath, messageType) {
        return clientPath === 'all' ||
            (clientPath === 'audio' && messageType === 'MEDIA_DATA_AUDIO') ||
            (clientPath === 'video' && messageType === 'MEDIA_DATA_VIDEO') ||
            (clientPath === 'transcript' && messageType === 'MEDIA_DATA_TRANSCRIPT');
    }
}

module.exports = MediaHandler; 