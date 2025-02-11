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

        // Add input validation
        const webhookInput = document.getElementById('webhookUrl');
        webhookInput.addEventListener('input', () => {
            // Disable start button when URL is modified
            document.getElementById('sendBtn').disabled = true;
            window.validatedWebhookUrl = null;
        });
    }

    static updateButtonStates(isActive) {
        document.getElementById('pauseBtn').disabled = !isActive;
        document.getElementById('resumeBtn').disabled = true;
        document.getElementById('stopBtn').disabled = !isActive;
        document.getElementById('endBtn').disabled = !isActive;
        document.getElementById('sendBtn').disabled = isActive;
        document.getElementById('validateBtn').disabled = isActive;
        document.getElementById('webhookUrl').disabled = isActive;
    }

    static handlePause() {
        if (!RTMSState.mediaSocket || RTMSState.sessionState === CONFIG.STATES.STOPPED) return;
        
        try {
            console.log("Pausing session...");
            RTMSState.sessionState = CONFIG.STATES.PAUSED;
            RTMSState.isStreamingEnabled = false;

            // Stop media recorders
            if (RTMSState.videoRecorder?.state === 'recording') {
                RTMSState.videoRecorder.pause();
            }
            if (RTMSState.audioRecorder?.state === 'recording') {
                RTMSState.audioRecorder.pause();
            }

            // Stop speech recognition
            if (RTMSState.recognition) {
                RTMSState.recognition.stop();
            }

            // Disable media tracks
            MediaHandler.toggleMediaTracks(false);
            
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

            // Resume media recorders
            if (RTMSState.videoRecorder?.state === 'paused') {
                RTMSState.videoRecorder.resume();
            }
            if (RTMSState.audioRecorder?.state === 'paused') {
                RTMSState.audioRecorder.resume();
            }

            // Resume speech recognition
            if (RTMSState.recognition) {
                RTMSState.recognition.start();
            }

            // Enable media tracks
            MediaHandler.toggleMediaTracks(true);
            
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
        RTMSState.sessionState = CONFIG.STATES.STOPPED;
        
        // Stop all recordings and streams
        MediaHandler.cleanup();
        
        if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
            WebSocketHandler.sendSessionStateUpdate(CONFIG.STATES.STOPPED, "ACTION_BY_USER");
        }

        // Update UI
        this.updateButtonStates(false);
        document.getElementById('sendBtn').disabled = false;

        // Close WebSocket connection
        if (RTMSState.mediaSocket) {
            RTMSState.mediaSocket.close();
            RTMSState.mediaSocket = null;
        }

        // Reset state
        RTMSState.mediaStream = null;
        RTMSState.videoRecorder = null;
        RTMSState.audioRecorder = null;
    }

    static handleEnd() {
        console.log("Ending meeting...");
        RTMSState.isStreamingEnabled = false;
        RTMSState.sessionState = CONFIG.STATES.STOPPED;

        // Stop all recordings and streams
        MediaHandler.cleanup();

        if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
            WebSocketHandler.sendSessionStateUpdate(CONFIG.STATES.STOPPED, "MEETING_ENDED");
            RTMSState.mediaSocket.close();
        }

        // Reset all state
        RTMSState.mediaSocket = null;
        RTMSState.mediaStream = null;
        RTMSState.videoRecorder = null;
        RTMSState.audioRecorder = null;

        // Update UI
        this.updateButtonStates(false);
        document.getElementById('sendBtn').disabled = false;
        document.getElementById('validateBtn').disabled = false;
        document.getElementById('webhookUrl').disabled = false;

        // Clear logs and transcripts
        document.getElementById('transcript').innerHTML = '';
        document.getElementById('response').innerHTML = '';
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

    static addSystemLog(type, message, details = null) {
        const logsDiv = document.getElementById('system-logs');
        if (!logsDiv) return;

        console.log('Adding system log:', { type, message, details }); // Debug log

        const entry = document.createElement('div');
        entry.className = 'log-entry system-log';
        
        // Add special styling for signaling logs
        if (type === 'Signaling') {
            entry.classList.add('signaling-log');
            if (details?.status) {
                entry.classList.add(details.status.toLowerCase());
            }
        }
        
        const timestamp = new Date().toLocaleTimeString();
        
        entry.innerHTML = `
            <div class="log-header">
                <div class="log-title">
                    <i class="fas ${type === 'Signaling' ? 'fa-signal' : 'fa-info-circle'}"></i>
                    <span>${type}: ${message}</span>
                </div>
                <div class="log-controls">
                    <span class="log-timestamp">${timestamp}</span>
                    ${details ? '<i class="fas fa-chevron-down"></i>' : ''}
                </div>
            </div>
            ${details ? `
            <div class="log-content">
                <div class="content-wrapper">
                    <pre>${JSON.stringify(details, null, 2)}</pre>
                </div>
            </div>
            ` : ''}
        `;

        if (details) {
            const header = entry.querySelector('.log-header');
            const content = entry.querySelector('.log-content');
            header.addEventListener('click', () => {
                const arrow = header.querySelector('.fas');
                arrow.classList.toggle('fa-chevron-down');
                arrow.classList.toggle('fa-chevron-up');
                content.classList.toggle('expanded');
            });
        }

        logsDiv.appendChild(entry);
        logsDiv.scrollTop = logsDiv.scrollHeight;
    }

    static addSignalingLog(event, details = null) {
        this.addSystemLog('Signaling', event, {
            status: 'info',
            timestamp: new Date().toISOString(),
            ...details
        });
    }
}

// Initialize UI when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const responseDiv = document.getElementById('response');
    if (responseDiv) {
        responseDiv.innerHTML = ''; // Clear existing content
    }
    UIController.init();
});

// Event types enum
const EventTypes = {
    WEBSOCKET: 'WebSocket',
    WEBHOOK: 'Webhook',
    SYSTEM: 'System',
    MESSAGE: 'Message',
    RTMS: 'RTMS',
    SIGNALING: 'Signaling'
};

// Store all transcripts and events
let transcriptHistory = [];
let eventHistory = [];

function parseEventData(data) {
    try {
        // If it's a string, try to parse it
        if (typeof data === 'string') {
            data = JSON.parse(data);
        }

        // For RTMS events (they're nested in sent.eventType)
        if (data.sent && data.sent.eventType) {
            return {
                type: 'rtms',
                name: data.sent.eventType,
                data: data
            };
        }

        // For WebSocket messages with msg_type (media data)
        if (data.msg_type) {
            return {
                type: data.msg_type.toLowerCase(),
                name: data.msg_type,  // Keep the original case for display
                data: data
            };
        }

        // For webhook validation
        if (data.event === 'endpoint.url_validation') {
            return {
                type: 'webhook',
                name: 'endpoint.url_validation',
                data: data
            };
        }

        // For console messages
        if (typeof data === 'string' && data.includes('Received message')) {
            const match = data.match(/Received message on media channel: (\w+)/);
            if (match) {
                return {
                    type: match[1].toLowerCase(),
                    name: match[1],
                    data: { message: data }
                };
            }
        }

        return {
            type: 'unknown',
            name: data.toString(),
            data: data
        };
    } catch (e) {
        console.error('Error parsing event data:', e);
        return {
            type: 'error',
            name: 'parse error',
            data: data
        };
    }
}

// First, let's clear any existing handlers
document.removeEventListener('DOMContentLoaded', setupSearch);

// Only handle webhook events
function addEventLog(data) {
    // Strict validation - only accept webhook events
    if (!data || !data.sent || !data.sent.eventType) {
        console.log('Skipping non-webhook event:', data);
        return;
    }

    const responseDiv = document.getElementById('response');
    if (!responseDiv) {
        console.error('Response div not found');
        return;
    }

    const entry = document.createElement('div');
    entry.className = 'log-entry webhook-event';
    
    const eventName = data.sent.eventType;
    const timestamp = new Date().toLocaleTimeString();
    
    entry.innerHTML = `
        <div class="log-header">
            <div class="log-title">
                <i class="fas fa-broadcast-tower"></i>
                <span>${eventName}</span>
            </div>
            <div class="log-controls">
                <span class="log-timestamp">${timestamp}</span>
                <i class="fas fa-chevron-down"></i>
            </div>
        </div>
        <div class="log-content">
            <button class="copy-button" title="Copy to clipboard">
                <i class="fas fa-copy"></i>
            </button>
            <div class="content-wrapper">
                <pre>${JSON.stringify(data, null, 2)}</pre>
            </div>
        </div>
    `;

    // Add click handlers
    const header = entry.querySelector('.log-header');
    const content = entry.querySelector('.log-content');
    const copyButton = entry.querySelector('.copy-button');

    header.addEventListener('click', () => {
        const arrow = header.querySelector('.fa-chevron-down, .fa-chevron-up');
        arrow.classList.toggle('fa-chevron-down');
        arrow.classList.toggle('fa-chevron-up');
        content.classList.toggle('expanded');
    });

    copyButton.addEventListener('click', (e) => {
        e.stopPropagation();
        const data = entry.querySelector('pre').textContent;
        navigator.clipboard.writeText(data);
        copyButton.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => {
            copyButton.innerHTML = '<i class="fas fa-copy"></i>';
        }, 2000);
    });

    responseDiv.appendChild(entry);
}

// Only expose what's absolutely necessary
window.addEventLog = addEventLog;

// Function to clear logs
function clearLogs() {
    document.getElementById('response').innerHTML = '';
    eventHistory = [];
}

// Function to clear transcripts
function clearTranscripts() {
    document.getElementById('transcript').innerHTML = '';
    transcriptHistory = [];
}

// Handle system events
function handleSystemEvent(event, data) {
    addEventLog({ event, data });
}

// Handle regular messages
function handleMessage(message) {
    addEventLog(message);
}

// Handle signaling events
function handleSignalingEvent(data) {
    addEventLog(data);
}