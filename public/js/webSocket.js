class WebSocketHandler {
    static async setupWebSocket(serverUrl) {
        let wsUrl = serverUrl;
        if (wsUrl.includes('replit.app')) {
            wsUrl = `ws://${CONFIG.WS_ENDPOINTS.DEFAULT_HOST}:${CONFIG.WS_ENDPOINTS.DEFAULT_PORT}`;
        }

        RTMSState.mediaSocket = new WebSocket(`${wsUrl}/all`);
        this.setupWebSocketHandlers();
    }

    static setupWebSocketHandlers() {
        RTMSState.mediaSocket.onopen = this.handleOpen;
        RTMSState.mediaSocket.onmessage = this.handleMessage;
        RTMSState.mediaSocket.onclose = this.handleClose;
        RTMSState.mediaSocket.onerror = this.handleError;
    }

    static handleOpen = () => {
        console.log('Connected to media server');
        RTMSState.sessionState = CONFIG.STATES.STARTED;
        MediaHandler.startRecording();
    }

    static handleMessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            console.log("Received message type:", message.msg_type);
            UIController.handleIncomingMedia(message);
        } catch (error) {
            console.error("Error processing message:", error);
        }
    }

    static handleClose = () => {
        console.log('Media connection closed');
        MediaHandler.stopRecording();
        UIController.handleStop();
    }

    static handleError = (error) => {
        console.error('WebSocket error:', error);
        MediaHandler.stopRecording();
        UIController.handleStop();
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