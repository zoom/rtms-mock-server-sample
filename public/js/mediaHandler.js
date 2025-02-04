class MediaHandler {
    static async startMediaStream(serverUrl) {
        console.log("Starting media stream with URL:", serverUrl);
        try {
            RTMSState.mediaStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            });

            console.log("Media stream obtained:", RTMSState.mediaStream.getTracks());
            await this.setupVideoDisplay();
            await this.setupMediaRecorders();
            await WebSocketHandler.setupWebSocket(serverUrl);

        } catch (error) {
            console.error("Error starting media stream:", error);
            UIController.showError(`Error starting media stream: ${error.message}`);
        }
    }

    static async setupVideoDisplay() {
        const mediaVideo = document.getElementById('mediaVideo');
        if (!mediaVideo) {
            console.error("Video element not found");
            return;
        }
        
        mediaVideo.srcObject = RTMSState.mediaStream;
        console.log("Video display setup complete");
        
        try {
            await mediaVideo.play();
            console.log("Video playback started");
        } catch (e) {
            console.error("Error playing video:", e);
        }
    }

    static setupMediaRecorders() {
        if (!RTMSState.mediaStream) {
            console.error("No media stream available");
            return;
        }

        const videoTrack = RTMSState.mediaStream.getVideoTracks()[0];
        const audioTrack = RTMSState.mediaStream.getAudioTracks()[0];

        if (!videoTrack || !audioTrack) {
            console.error("Missing media tracks:", { video: !!videoTrack, audio: !!audioTrack });
            return;
        }

        console.log("Setting up media recorders with tracks:", { videoTrack, audioTrack });

        const videoStream = new MediaStream([videoTrack]);
        const audioStream = new MediaStream([audioTrack]);

        RTMSState.videoRecorder = new MediaRecorder(videoStream, CONFIG.MEDIA.VIDEO_CONFIG);
        RTMSState.audioRecorder = new MediaRecorder(audioStream, CONFIG.MEDIA.AUDIO_CONFIG);

        this.setupRecorderEventHandlers();
        console.log("Media recorders setup complete");
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

    static cleanup() {
        if (RTMSState.mediaStream) {
            RTMSState.mediaStream.getTracks().forEach(track => track.stop());
        }
        document.getElementById('mediaVideo').srcObject = null;
    }
} 