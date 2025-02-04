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

        const videoStream = new MediaStream([videoTrack]);
        const audioStream = new MediaStream([audioTrack]);

        RTMSState.videoRecorder = new MediaRecorder(videoStream, CONFIG.MEDIA.VIDEO_CONFIG);
        RTMSState.audioRecorder = new MediaRecorder(audioStream, CONFIG.MEDIA.AUDIO_CONFIG);

        this.setupRecorderEventHandlers();
    }

    static setupRecorderEventHandlers() {
        RTMSState.videoRecorder.ondataavailable = WebSocketHandler.handleVideoData;
        RTMSState.audioRecorder.ondataavailable = WebSocketHandler.handleAudioData;
        
        RTMSState.videoRecorder.onstop = () => console.log("Video recorder stopped");
        RTMSState.audioRecorder.onstop = () => console.log("Audio recorder stopped");
    }

    static startRecording() {
        RTMSState.videoRecorder.start(100);
        RTMSState.audioRecorder.start(100);
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