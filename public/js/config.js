// Universal constants shared between client and server
const CONFIG = {
    PORTS: {
        HANDSHAKE: 9092,
        MEDIA: 8081,
        WEBHOOK: 3000
    },
    HOST: "0.0.0.0",
    ENDPOINTS: {
        AUDIO: "/audio",
        VIDEO: "/video",
        TRANSCRIPT: "/transcript",
        ALL: "/all"
    },
    STATES: {
        STARTED: "STARTED",
        PAUSED: "PAUSED",
        RESUMED: "RESUMED",
        STOPPED: "STOPPED"
    },
    MEDIA: {
        VIDEO_CONFIG: {
            mimeType: 'video/webm',
            videoBitsPerSecond: 1000000
        },
        AUDIO_CONFIG: {
            mimeType: 'audio/webm',
            audioBitsPerSecond: 128000
        }
    }
};

// Client-side only state (wrapped in try-catch for server environment)
try {
    window.RTMSState = {
        mediaSocket: null,
        mediaStream: null,
        sessionState: CONFIG.STATES.STOPPED,
        isStreamingEnabled: true,
        videoRecorder: null,
        audioRecorder: null
    };
} catch (e) {
    // Ignore window is not defined error on server
}

// Export for Node.js environment
try {
    module.exports = CONFIG;
} catch (e) {
    // Ignore module is not defined error in browser
} 