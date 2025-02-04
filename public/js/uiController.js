class UIController {
    static init() {
        this.attachEventListeners();
    }

    static attachEventListeners() {
        document.getElementById('validateBtn').addEventListener('click', APIHandler.validateWebhook);
        document.getElementById('sendBtn').addEventListener('click', APIHandler.sendWebhook);
        document.getElementById('pauseBtn').addEventListener('click', this.handlePause);
        document.getElementById('resumeBtn').addEventListener('click', this.handleResume);
        document.getElementById('stopBtn').addEventListener('click', this.handleStop);
        document.getElementById('endBtn').addEventListener('click', this.handleEnd);
    }

    static updateButtonStates(isActive) {
        document.getElementById('pauseBtn').disabled = !isActive;
        document.getElementById('resumeBtn').disabled = true;
        document.getElementById('stopBtn').disabled = !isActive;
        document.getElementById('endBtn').disabled = !isActive;
        document.getElementById('sendBtn').disabled = isActive;
    }

    static handlePause() {
        if (!RTMSState.mediaSocket || RTMSState.sessionState === CONFIG.STATES.STOPPED) return;
        
        try {
            console.log("Pausing session...");
            RTMSState.sessionState = CONFIG.STATES.PAUSED;
            RTMSState.isStreamingEnabled = false;

            MediaHandler.toggleMediaTracks(false);
            if (RTMSState.recognition) {
                RTMSState.recognition.stop();
            }
            WebSocketHandler.sendSessionStateUpdate(CONFIG.STATES.PAUSED, "ACTION_BY_USER");
            
            document.getElementById('resumeBtn').disabled = false;
            document.getElementById('pauseBtn').disabled = true;

        } catch (error) {
            console.error("Error pausing session:", error);
        }
    }

    static handleResume() {
        if (!RTMSState.mediaSocket || RTMSState.sessionState === CONFIG.STATES.STOPPED) {
            alert('Session is stopped. Please start a new session.');
            return;
        }

        try {
            console.log("Resuming session...");
            RTMSState.sessionState = CONFIG.STATES.RESUMED;
            RTMSState.isStreamingEnabled = true;

            MediaHandler.toggleMediaTracks(true);
            if (RTMSState.recognition) {
                RTMSState.recognition.start();
            }
            WebSocketHandler.sendSessionStateUpdate(CONFIG.STATES.RESUMED, "ACTION_BY_USER");
            
            document.getElementById('pauseBtn').disabled = false;
            document.getElementById('resumeBtn').disabled = true;

        } catch (error) {
            console.error("Error resuming session:", error);
        }
    }

    static handleStop() {
        console.log("Stopping session...");
        RTMSState.isStreamingEnabled = false;
        
        if (RTMSState.mediaSocket && RTMSState.sessionState !== CONFIG.STATES.STOPPED) {
            WebSocketHandler.sendSessionStateUpdate(CONFIG.STATES.STOPPED, "ACTION_BY_USER");
        }

        RTMSState.sessionState = CONFIG.STATES.STOPPED;
        MediaHandler.cleanup();
        this.updateButtonStates(false);

        if (RTMSState.mediaSocket) {
            setTimeout(() => {
                RTMSState.mediaSocket.close();
                RTMSState.mediaSocket = null;
                RTMSState.mediaStream = null;
                RTMSState.videoRecorder = null;
                RTMSState.audioRecorder = null;
            }, 100);
        }
    }

    static handleEnd() {
        if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
            WebSocketHandler.sendSessionStateUpdate(CONFIG.STATES.STOPPED, "ACTION_BY_USER");
        }

        this.updateButtonStates(false);
        MediaHandler.cleanup();
        RTMSState.sessionState = CONFIG.STATES.STOPPED;
    }

    static handleIncomingMedia(message) {
        if (message.msg_type === "MEDIA_DATA_VIDEO") {
            this.updateVideoElement(message.content.data);
        }
        else if (message.msg_type === "MEDIA_DATA_AUDIO") {
            this.updateAudioElement(message.content.data);
        }
    }

    static updateVideoElement(videoData) {
        const blob = new Blob([Uint8Array.from(atob(videoData), c => c.charCodeAt(0))], 
            { type: 'video/webm' });
        const videoUrl = URL.createObjectURL(blob);
        const mediaVideo = document.getElementById('mediaVideo');
        if (mediaVideo.src) {
            URL.revokeObjectURL(mediaVideo.src);
        }
        mediaVideo.src = videoUrl;
    }

    static updateAudioElement(audioData) {
        const blob = new Blob([Uint8Array.from(atob(audioData), c => c.charCodeAt(0))], 
            { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(blob);
        const mediaAudio = document.getElementById('mediaAudio');
        if (mediaAudio.src) {
            URL.revokeObjectURL(mediaAudio.src);
        }
        mediaAudio.src = audioUrl;
    }

    static showError(message) {
        document.getElementById('response').innerHTML = message;
    }
}

// Initialize UI when DOM is ready
document.addEventListener('DOMContentLoaded', () => UIController.init()); 