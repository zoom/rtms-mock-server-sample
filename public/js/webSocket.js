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
        console.log('handleAudioData called');
        if (event.data.size > 0 && RTMSState.mediaSocket?.readyState === WebSocket.OPEN && RTMSState.isStreamingEnabled) {
            console.log('Audio data received from recorder, size:', event.data.size);
            console.log('WebSocket state:', RTMSState.mediaSocket.readyState);
            console.log('Streaming enabled:', RTMSState.isStreamingEnabled);
            
            const reader = new FileReader();
            reader.onloadend = async () => {
                console.log('Audio data read as ArrayBuffer');
                try {
                    await this.convertAudio(reader.result);
                } catch (error) {
                    console.error('Error in convertAudio:', error);
                }
            };
            reader.onerror = (error) => {
                console.error('Error reading audio data:', error);
            };
            reader.readAsArrayBuffer(event.data);
        } else {
            console.log('Skipping audio data:', {
                dataSize: event.data.size,
                wsState: RTMSState.mediaSocket?.readyState,
                streamingEnabled: RTMSState.isStreamingEnabled
            });
        }
    }

    static async sendMediaData(data, type) {
        try {
            const reader = new FileReader();
            
            reader.onloadend = async () => {
                let processedData;
                let metadata = {};
                
                if (type === "MEDIA_DATA_AUDIO") {
                    processedData = await this.convertAudio(reader.result);
                    if (!processedData) return; // Skip if conversion failed
                    
                    
                } else if (type === "MEDIA_DATA_VIDEO") {
                    processedData = await this.convertVideo(reader.result);
                    if (!processedData) return; // Skip if conversion failed
                    
                  
                }

                if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                    RTMSState.mediaSocket.send(JSON.stringify({
                        msg_type: type,
                        content: {
                            user_id: 0,
                            data: processedData,
                            metadata: metadata,
                            timestamp: Date.now()
                        }
                    }));
                }
            };
            
            reader.readAsArrayBuffer(data);
        } catch (error) {
            console.error("Error processing media data:", error);
        }
    }

    static async convertAudio(audioData) {
        try {
            console.log('Starting audio conversion');
            if (!this.audioContext) {
                console.log('Creating new AudioContext');
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: 16000
                });
                
                try {
                    console.log('Loading audio-processor.js');
                    await this.audioContext.audioWorklet.addModule('js/audio-processor.js');
                    console.log('Audio processor loaded successfully');
                } catch (error) {
                    console.error('Failed to load audio processor:', error);
                    throw error;
                }

                const audioNode = new AudioWorkletNode(this.audioContext, 'audio-processor');
                console.log('AudioWorkletNode created');
                
                audioNode.port.onmessage = (event) => {
                    console.log('Received message from audio processor:', event.data);
                    if (event.data.pcmData && RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                        const pcmArray = new Int16Array(event.data.pcmData);
                        const base64Data = btoa(String.fromCharCode.apply(null, new Uint8Array(pcmArray.buffer)));
                        
                        console.log('Sending audio data over WebSocket');
                        RTMSState.mediaSocket.send(JSON.stringify({
                            msg_type: "MEDIA_DATA_AUDIO",
                            content: {
                                user_id: 0,
                                data: base64Data,
                                metadata: {
                                    content_type: "RAW_AUDIO",
                                    sample_rate: 16000,
                                    channel: 1,
                                    codec: "L16",
                                    data_opt: "AUDIO_MIXED_STREAM",
                                    send_interval: 20
                                },
                                timestamp: Date.now()
                            }
                        }));
                    }
                };

                audioNode.port.onmessageerror = (error) => {
                    console.error('Audio processor message error:', error);
                };

                this.audioNode = audioNode;
            }

            // Create source buffer
            console.log('Decoding audio data');
            const audioBuffer = await this.audioContext.decodeAudioData(audioData);
            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            
            console.log('Connecting audio nodes');
            source.connect(this.audioNode);
            this.audioNode.connect(this.audioContext.destination);
            
            source.start(0);
            return true;

        } catch (error) {
            console.error("Error converting audio:", error);
            console.error("Error details:", error.message);
            console.error("Error stack:", error.stack);
            return null;
        }
    }

    static async convertVideo(videoData) {
        try {
            // Create a video element to decode the WebM
            const video = document.createElement('video');
            video.autoplay = true;
            video.muted = true;
            
            // Set up video source
            const videoUrl = URL.createObjectURL(new Blob([videoData], { type: 'video/webm' }));
            video.src = videoUrl;
            
            // Create canvas for frame extraction
            const canvas = document.createElement('canvas');
            canvas.width = 1280; // HD width
            canvas.height = 720; // HD height
            const ctx = canvas.getContext('2d');
            
            // Process current frame
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const jpegData = canvas.toDataURL('image/jpeg', 0.9);
            
            // Cleanup
            URL.revokeObjectURL(videoUrl);
            
            return jpegData.split(',')[1]; // Return base64 data only
        } catch (error) {
            console.error("Error converting video:", error);
            return null;
        }
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