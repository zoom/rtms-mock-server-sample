class MediaHandler {
    static async startMediaStream(serverUrl) {
        console.log("Starting media stream with URL:", serverUrl);
        try {
            RTMSState.mediaStream = await navigator.mediaDevices.getUserMedia({ 
                video: true, 
                audio: true 
            });

            await this.setupVideoDisplay();
            await this.setupMediaRecorders();
            await this.setupSpeechRecognition();
            await WebSocketHandler.setupWebSocket(serverUrl);

        } catch (error) {
            console.error("Error starting media stream:", error);
            UIController.showError(`Error starting media stream: ${error.message}`);
        }
    }

    static async setupVideoDisplay() {
        const mediaVideo = document.getElementById('mediaVideo');
        mediaVideo.srcObject = RTMSState.mediaStream;
        await mediaVideo.play().catch(e => console.error("Error playing media video:", e));
        UIController.updateButtonStates(true);
    }

    static async setupMediaRecorders() {
        const videoTrack = RTMSState.mediaStream.getVideoTracks()[0];
        const audioTrack = RTMSState.mediaStream.getAudioTracks()[0];

        // Log to both console and send to server for debugging
        const logDebug = (msg) => {
            console.log(msg);
            if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                RTMSState.mediaSocket.send(JSON.stringify({
                    msg_type: "DEBUG_LOG",
                    content: { message: msg }
                }));
            }
        };

        logDebug('Setting up MediaRecorders');
        logDebug(`Audio track: ${audioTrack?.label}`);
        logDebug(`Audio track enabled: ${audioTrack?.enabled}`);

        const videoStream = new MediaStream([videoTrack]);
        const audioStream = new MediaStream([audioTrack]);

        // Configure for more frequent chunks
        const videoConfig = {
            ...CONFIG.MEDIA.VIDEO_CONFIG,
            timeslice: 200 // Send video chunks every 200ms
        };
        
        const audioConfig = {
            ...CONFIG.MEDIA.AUDIO_CONFIG,
            timeslice: 20, // Send audio chunks every 20ms
            mimeType: 'audio/webm;codecs=opus' // Explicitly set audio codec
        };

        RTMSState.videoRecorder = new MediaRecorder(videoStream, videoConfig);
        RTMSState.audioRecorder = new MediaRecorder(audioStream, audioConfig);

        logDebug(`Audio recorder state: ${RTMSState.audioRecorder.state}`);
        logDebug(`Audio recorder mimeType: ${RTMSState.audioRecorder.mimeType}`);

        this.setupRecorderEventHandlers();
    }

    static setupRecorderEventHandlers() {
        const logDebug = (msg) => {
            console.log(msg);
            if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                RTMSState.mediaSocket.send(JSON.stringify({
                    msg_type: "DEBUG_LOG",
                    content: { message: msg }
                }));
            }
        };

        logDebug('Setting up recorder event handlers');
        
        RTMSState.videoRecorder.ondataavailable = WebSocketHandler.handleVideoData;
        RTMSState.audioRecorder.ondataavailable = (event) => {
            logDebug(`Audio data available, size: ${event.data.size}`);
            // Send audio data directly without conversion first to verify we're getting data
            if (event.data.size > 0 && RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64data = reader.result.split(',')[1];
                    RTMSState.mediaSocket.send(JSON.stringify({
                        msg_type: "MEDIA_DATA_AUDIO",
                        content: {
                            user_id: 0,
                            data: base64data,
                            timestamp: Date.now()
                        }
                    }));
                };
                reader.readAsDataURL(event.data);
            }
        };
        
        RTMSState.audioRecorder.onstart = () => logDebug('Audio recorder started');
        RTMSState.audioRecorder.onpause = () => logDebug('Audio recorder paused');
        RTMSState.audioRecorder.onresume = () => logDebug('Audio recorder resumed');
        RTMSState.audioRecorder.onstop = () => logDebug('Audio recorder stopped');
        RTMSState.audioRecorder.onerror = (e) => logDebug(`Audio recorder error: ${e.name}`);
    }

    static startRecording() {
        try {
            RTMSState.videoRecorder.start(200);
            RTMSState.audioRecorder.start(20);
            console.log('Started recording');
            if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                RTMSState.mediaSocket.send(JSON.stringify({
                    msg_type: "DEBUG_LOG",
                    content: { message: 'Started recording' }
                }));
            }
        } catch (error) {
            console.error('Error starting recording:', error);
            if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                RTMSState.mediaSocket.send(JSON.stringify({
                    msg_type: "DEBUG_LOG",
                    content: { message: `Error starting recording: ${error.message}` }
                }));
            }
        }
    }

    static stopRecording() {
        if (RTMSState.videoRecorder?.state !== 'inactive') {
            RTMSState.videoRecorder.stop();
        }
        if (RTMSState.audioRecorder?.state !== 'inactive') {
            RTMSState.audioRecorder.stop();
        }
    }

    static toggleMediaTracks(enabled) {
        if (RTMSState.mediaStream) {
            RTMSState.mediaStream.getTracks().forEach(track => {
                track.enabled = enabled;
                console.log(`Track ${track.kind} ${enabled ? 'enabled' : 'disabled'}`);
            });
        }
    }

    static async setupSpeechRecognition() {
        if ('webkitSpeechRecognition' in window) {
            RTMSState.recognition = new webkitSpeechRecognition();
            RTMSState.recognition.continuous = true;
            RTMSState.recognition.interimResults = true;
            RTMSState.recognition.lang = 'en-US';

            RTMSState.recognition.onresult = (event) => {
                let transcript = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        transcript += event.results[i][0].transcript;
                    }
                }
                
                // Update UI
                document.getElementById('transcript').innerText = transcript;

                // Send transcript through WebSocket
                if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                    RTMSState.mediaSocket.send(JSON.stringify({
                        msg_type: "MEDIA_DATA_TRANSCRIPT",
                        content: {
                            user_id: 0,
                            data: transcript,
                            timestamp: Date.now()
                        }
                    }));
                }
            };

            RTMSState.recognition.start();
        } else {
            console.warn('Speech Recognition API not supported in this browser');
        }
    }

    static cleanup() {
        if (RTMSState.mediaStream) {
            RTMSState.mediaStream.getTracks().forEach(track => track.stop());
        }
        if (RTMSState.recognition) {
            RTMSState.recognition.stop();
        }
        document.getElementById('mediaVideo').srcObject = null;
    }
} 