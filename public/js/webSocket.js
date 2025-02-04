class WebSocketHandler {
    static async setupWebSocket(serverUrl) {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsHost = CONFIG.HOST === '0.0.0.0' ? window.location.hostname : CONFIG.HOST;
        const wsUrl = `${wsProtocol}//${wsHost}:${CONFIG.PORTS.MEDIA}/all`;
        
        console.log('Connecting to WebSocket URL:', wsUrl);
        RTMSState.mediaSocket = new WebSocket(wsUrl);
        this.setupWebSocketHandlers();
    }

    static setupWebSocketHandlers() {
        if (!RTMSState.mediaSocket) {
            console.error('Media socket not initialized');
            return;
        }

        RTMSState.mediaSocket.onopen = () => {
            console.log('Connected to media server');
            RTMSState.sessionState = CONFIG.STATES.STARTED;
            MediaHandler.startRecording();
            UIController.updateButtonStates(true);
        };

        RTMSState.mediaSocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log("Received message:", message);
                UIController.handleIncomingMedia(message);
            } catch (error) {
                console.error("Error processing message:", error);
            }
        };

        RTMSState.mediaSocket.onclose = () => {
            console.log('Media connection closed');
            MediaHandler.stopRecording();
            UIController.handleStop();
        };

        RTMSState.mediaSocket.onerror = (error) => {
            console.error('WebSocket error:', error);
            MediaHandler.stopRecording();
            UIController.handleStop();
        };
    }

    static handleVideoData = async (event) => {
        if (event.data.size > 0 && RTMSState.mediaSocket?.readyState === WebSocket.OPEN && RTMSState.isStreamingEnabled) {
            await this.sendMediaData(event.data, "MEDIA_DATA_VIDEO");
        }
    }

    static handleAudioData = async (event) => {
        if (event.data.size > 0 && RTMSState.mediaSocket?.readyState === WebSocket.OPEN && RTMSState.isStreamingEnabled) {
            await this.sendMediaData(event.data, "MEDIA_DATA_AUDIO");
        }
    }

    static async sendMediaData(data, type) {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64data = reader.result.split(',')[1];
            RTMSState.mediaSocket.send(JSON.stringify({
                msg_type: type,
                content: {
                    user_id: 0,
                    data: base64data,
                    timestamp: Date.now()
                }
            }));
        };
        reader.readAsDataURL(data);
    }

    static sendSessionStateUpdate(state, stopReason) {
        if (!RTMSState.mediaSocket || RTMSState.mediaSocket.readyState !== WebSocket.OPEN) return;

        RTMSState.mediaSocket.send(JSON.stringify({
            msg_type: "SESSION_STATE_UPDATE",
            rmts_session_id: RTMSState.mediaSocket.rtmsSessionId,
            state: state,
            stop_reason: stopReason,
            timestamp: Date.now()
        }));
    }
} 