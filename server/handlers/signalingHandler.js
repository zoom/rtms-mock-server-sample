const WebSocketUtils = require('../utils/wsUtils');
const CredentialsManager = require('../utils/credentialsManager');
const CONFIG = require('../config/serverConfig');
const crypto = require('crypto');
const MESSAGE_TYPES = require('../constants/messageTypes');

class SignalingHandler {
    static STOP_REASONS = [
        'STOP_BC_HOST_TRIGGERED',
        'STOP_BC_USER_TRIGGERED',
        'STOP_BC_USER_LEFT',
        'STOP_BC_USER_EJECTED',
        'STOP_BC_APP_DISABLED_BY_HOST',
        'STOP_BC_STREAM_CANCELED',
        'STOP_BC_STREAM_REVOKED',
        'STOP_BC_ALL_APPS_DISABLED'
    ];

    static getRandomStopReason() {
        const randomIndex = Math.floor(Math.random() * this.STOP_REASONS.length);
        return this.STOP_REASONS[randomIndex];
    }

    static handleMessage(ws, data) {
        try {
            const message = JSON.parse(data);
            
            // Add log for incoming signaling message
            this.emitSignalingLog('Received', message.msg_type, message);
            
            switch (message.msg_type) {
                case MESSAGE_TYPES.RTMS_MESSAGE_TYPE.SIGNALING_HAND_SHAKE_REQ:
                    this.handleHandshake(ws, message);
                    break;
                case MESSAGE_TYPES.RTMS_MESSAGE_TYPE.EVENT_SUBSCRIPTION:
                    this.handleEventSubscription(ws, message);
                    break;
                case MESSAGE_TYPES.RTMS_MESSAGE_TYPE.SESSION_STATE_UPDATE:
                    this.handleSessionStateUpdate(ws, message);
                    break;
                case MESSAGE_TYPES.RTMS_MESSAGE_TYPE.KEEP_ALIVE_RESP:
                    this.handleKeepAliveResponse(ws, message);
                    break;
                default:
                    console.log("Unknown signaling message type:", message.msg_type);
            }
        } catch (error) {
            this.emitSignalingLog('Error', 'Message Processing', { error: error.message });
        }
    }

    static handleHandshake(ws, message) {
        this.emitSignalingLog('Info', 'Handshake Request Received', message);
        
        if (!this.validateHandshakeMessage(ws, message)) {
            this.emitSignalingLog('Failed', 'Handshake Validation Failed', message);
            return;
        }

        this.emitSignalingLog('Success', 'Handshake Validation Successful', message);
        
        try {
            // Initialize the media server if it doesn't exist or was previously closed
            if (!global.mediaServer || global.mediaServer.isClosed) {
                this.emitSignalingLog('Info', 'Initializing Media Server');
                try {
                    const MediaHandler = require('./mediaHandler');
                    const mediaHttpServer = require('../setup/serverSetup').setupMediaServer();
                    global.mediaServer = MediaHandler.setupMediaServer(mediaHttpServer);
                    
                    // Set up error handler for media server
                    global.mediaServer.on('error', (error) => {
                        this.emitSignalingLog('Error', 'Media Server Error', { error: error.message });
                    });

                    // Add a ready check
                    if (!global.mediaServer.isReady) {
                        throw new Error('Media server failed to initialize properly');
                    }
                } catch (initError) {
                    this.emitSignalingLog('Error', 'Media Server Initialization Failed', { error: initError.message });
                    WebSocketUtils.sendWebSocketResponse(ws, MESSAGE_TYPES.RTMS_MESSAGE_TYPE.SIGNALING_HAND_SHAKE_RESP, MESSAGE_TYPES.RTMS_STATUS_CODE.STATUS_ERROR, "Failed to initialize media server");
                    return;
                }
            }
            
            const response = {
                media_server: {
                    server_urls: {
                        audio: `ws://${CONFIG.HOST}:${CONFIG.MEDIA_PORT}${CONFIG.ENDPOINTS.AUDIO}`,
                        video: `ws://${CONFIG.HOST}:${CONFIG.MEDIA_PORT}${CONFIG.ENDPOINTS.VIDEO}`,
                        transcript: `ws://${CONFIG.HOST}:${CONFIG.MEDIA_PORT}${CONFIG.ENDPOINTS.TRANSCRIPT}`,
                        all: `ws://${CONFIG.HOST}:${CONFIG.MEDIA_PORT}${CONFIG.ENDPOINTS.ALL}`,
                    },
                    srtp_keys: this.generateSRTPKeys(),
                }
            };

            // Store the websocket connection globally
            global.signalingWebsocket = ws;

            // Set up keep-alive handling
            ws.isAlive = true;
            ws.keepAliveInterval = setInterval(() => {
                if (!ws.isAlive) {
                    this.emitSignalingLog('Error', 'Keep-alive timeout');
                    clearInterval(ws.keepAliveInterval);
                    ws.terminate();
                    return;
                }
                ws.isAlive = false;
                WebSocketUtils.sendWebSocketResponse(ws, MESSAGE_TYPES.RTMS_MESSAGE_TYPE.KEEP_ALIVE_REQ, MESSAGE_TYPES.RTMS_STATUS_CODE.STATUS_OK);
            }, 30000);

            this.emitSignalingLog('Info', 'Sending Handshake Response', response);
            WebSocketUtils.sendWebSocketResponse(ws, MESSAGE_TYPES.RTMS_MESSAGE_TYPE.SIGNALING_HAND_SHAKE_RESP, MESSAGE_TYPES.RTMS_STATUS_CODE.STATUS_OK, null, response);
        } catch (error) {
            this.emitSignalingLog('Error', 'Handshake Failed', { error: error.message });
            WebSocketUtils.sendWebSocketResponse(ws, MESSAGE_TYPES.RTMS_MESSAGE_TYPE.SIGNALING_HAND_SHAKE_RESP, MESSAGE_TYPES.RTMS_STATUS_CODE.STATUS_ERROR, "Failed to initialize media server");
        }
    }

    static validateHandshakeMessage(ws, message) {
        // Check protocol version
        if (message.protocol_version !== 1) {
            WebSocketUtils.sendWebSocketResponse(ws, MESSAGE_TYPES.RTMS_MESSAGE_TYPE.SIGNALING_HAND_SHAKE_RESP, MESSAGE_TYPES.RTMS_STATUS_CODE.STATUS_INVALID_VERSION, "Unsupported protocol version");
            return false;
        }

        // Check required fields
        const { meeting_uuid, rtms_stream_id, signature } = message;
        if (!meeting_uuid || !rtms_stream_id || !signature) {
            WebSocketUtils.sendWebSocketResponse(ws, MESSAGE_TYPES.RTMS_MESSAGE_TYPE.SIGNALING_HAND_SHAKE_RESP, MESSAGE_TYPES.RTMS_STATUS_CODE.STATUS_INVALID_MESSAGE, "Missing required fields");
            return false;
        }

        // Load credentials
        const credentials = CredentialsManager.loadCredentials();
        if (!credentials) {
            WebSocketUtils.sendWebSocketResponse(ws, MESSAGE_TYPES.RTMS_MESSAGE_TYPE.SIGNALING_HAND_SHAKE_RESP, MESSAGE_TYPES.RTMS_STATUS_CODE.STATUS_UNAUTHORIZED, "Failed to load credentials");
            return false;
        }

        // Verify meeting_uuid and rtms_stream_id
        const streamInfo = credentials.stream_meeting_info.find(
            (info) => info.meeting_uuid === meeting_uuid && 
                      info.rtms_stream_id === rtms_stream_id
        );

        if (!streamInfo) {
            WebSocketUtils.sendWebSocketResponse(ws, MESSAGE_TYPES.RTMS_MESSAGE_TYPE.SIGNALING_HAND_SHAKE_RESP, MESSAGE_TYPES.RTMS_STATUS_CODE.STATUS_UNAUTHORIZED, "Invalid meeting or stream ID");
            return false;
        }

        // Verify signature
        const matchingCred = credentials.auth_credentials.find((cred) => 
            CredentialsManager.validateSignature(
                signature,
                cred.client_id,
                meeting_uuid,
                rtms_stream_id,
                cred.client_secret
            )
        );

        if (!matchingCred) {
            WebSocketUtils.sendWebSocketResponse(ws, MESSAGE_TYPES.RTMS_MESSAGE_TYPE.SIGNALING_HAND_SHAKE_RESP, MESSAGE_TYPES.RTMS_STATUS_CODE.STATUS_UNAUTHORIZED, "Invalid signature");
            return false;
        }

        // Store the validated credentials
        ws.validatedCredentials = matchingCred;

        // Add HMAC-SHA256 verification
        const clientSecret = matchingCred.client_secret;
        const clientId = matchingCred.client_id;
        const calculatedSignature = crypto.createHmac('sha256', clientSecret)
            .update(`${clientId},${meeting_uuid},${rtms_stream_id}`)
            .digest('hex');
        
        if (calculatedSignature !== signature) {
            WebSocketUtils.sendWebSocketResponse(ws, MESSAGE_TYPES.RTMS_MESSAGE_TYPE.SIGNALING_HAND_SHAKE_RESP, MESSAGE_TYPES.RTMS_STATUS_CODE.STATUS_INVALID_SIGNATURE);
            return false;
        }

        return true;
    }

    static generateSRTPKeys() {
        return {
            audio: crypto.randomBytes(32).toString("hex"),
            video: crypto.randomBytes(32).toString("hex"),
            share: crypto.randomBytes(32).toString("hex"),
        };
    }

    static handleClose(ws) {
        this.emitSignalingLog('Event', 'Connection Closed');
        console.log("Handshake connection closed");
        
        // Clear the keep-alive interval
        if (ws && ws.keepAliveInterval) {
            clearInterval(ws.keepAliveInterval);
        }
        
        // Only clear the signaling websocket if it matches the current one
        if (global.signalingWebsocket === ws) {
            global.signalingWebsocket = null;
        }

        // Don't close the media server, let it handle reconnections
    }

    static handleError(error) {
        this.emitSignalingLog('Error', 'Connection Error', { error: error?.message });
        console.log("Handshake connection error");
        if (global.mediaServer) {
            global.mediaServer.close();
            global.mediaServer = null;
        }
        global.signalingWebsocket = null;
    }

    static handleEventSubscription(ws, message) {
        const { events } = message;
        ws.subscribedEvents = new Set();
        events.forEach(event => {
            if (event.subscribe) {
                ws.subscribedEvents.add(event.event_type);
            }
        });
        this.emitSignalingLog('Info', 'Event Subscription Updated', {
            subscribed_events: Array.from(ws.subscribedEvents)
        });
    }

    static handleSessionStateUpdate(ws, message) {
        const { rtms_session_id, state } = message;
        let uiState;
        let broadcastMessage;

        switch (state) {
            case MESSAGE_TYPES.RTMS_SESSION_STATE.STARTED:
                uiState = {
                    resumeBtn: { disabled: true },
                    pauseBtn: { disabled: false },
                    sendBtn: { disabled: false },
                    stopBtn: { disabled: false },
                    startRtmsBtn: { disabled: true },
                    endBtn: { disabled: false }
                };

                broadcastMessage = {
                    msg_type: MESSAGE_TYPES.RTMS_MESSAGE_TYPE.SESSION_STATE_UPDATE,
                    rtms_session_id: rtms_session_id,
                    state: MESSAGE_TYPES.RTMS_SESSION_STATE.STARTED,
                    ui_state: uiState,
                    timestamp: Date.now()
                };

                this.emitSignalingLog('Info', 'Session State Update - Start', {
                    state,
                    rtms_session_id,
                    ui_state: uiState
                });

                // Send to current client and broadcast
                if (ws.readyState === 1) {
                    ws.send(JSON.stringify(broadcastMessage));
                }
                
                if (global.signalingWebsocket && global.signalingWebsocket.readyState === 1) {
                    global.signalingWebsocket.send(JSON.stringify(broadcastMessage));
                }
                break;

            case MESSAGE_TYPES.RTMS_SESSION_STATE.RESUMED:
                uiState = {
                    resumeBtn: { disabled: true },
                    pauseBtn: { disabled: false },
                    sendBtn: { disabled: false },
                    stopBtn: { disabled: false },
                    startRtmsBtn: { disabled: true },
                    endBtn: { disabled: false }
                };

                broadcastMessage = {
                    msg_type: MESSAGE_TYPES.RTMS_MESSAGE_TYPE.SESSION_STATE_UPDATE,
                    rtms_session_id: rtms_session_id,
                    state: MESSAGE_TYPES.RTMS_SESSION_STATE.RESUMED,
                    ui_state: uiState,
                    timestamp: Date.now()
                };

                this.emitSignalingLog('Info', 'Session State Update - Resume', {
                    state,
                    rtms_session_id,
                    ui_state: uiState
                });

                // Send to current client and broadcast
                if (ws.readyState === 1) {
                    ws.send(JSON.stringify(broadcastMessage));
                }

                // Log broadcast message send
                if (global.signalingWebsocket && global.signalingWebsocket.readyState === 1) {
                    this.emitSignalingLog('Debug', 'Broadcasting RESUMED Message', {
                        message: broadcastMessage,
                        timestamp: Date.now()
                    });
                    global.signalingWebsocket.send(JSON.stringify({
                        ...broadcastMessage,
                        is_broadcast: true
                    }));
                }
                break;

            case MESSAGE_TYPES.RTMS_SESSION_STATE.PAUSED:
                uiState = {
                    resumeBtn: { disabled: false },
                    pauseBtn: { disabled: true },
                    sendBtn: { disabled: true },
                    stopBtn: { disabled: false },
                    startRtmsBtn: { disabled: true },
                    endBtn: { disabled: false }
                };

                broadcastMessage = {
                    msg_type: MESSAGE_TYPES.RTMS_MESSAGE_TYPE.SESSION_STATE_UPDATE,
                    rtms_session_id: rtms_session_id,
                    state: MESSAGE_TYPES.RTMS_SESSION_STATE.PAUSED,
                    ui_state: uiState,
                    timestamp: Date.now()
                };

                this.emitSignalingLog('Info', 'Session State Update - Pause', {
                    state,
                    rtms_session_id,
                    ui_state: uiState
                });

                // Send to current client and broadcast
                if (ws.readyState === 1) {
                    ws.send(JSON.stringify(broadcastMessage));
                }
                
                if (global.signalingWebsocket && global.signalingWebsocket.readyState === 1) {
                    global.signalingWebsocket.send(JSON.stringify(broadcastMessage));
                }
                break;

            case MESSAGE_TYPES.RTMS_SESSION_STATE.STOPPED:
                const stopReason = this.getRandomStopReason();
                uiState = {
                    resumeBtn: { disabled: true },
                    pauseBtn: { disabled: true },
                    sendBtn: { disabled: true },
                    stopBtn: { disabled: true },
                    startRtmsBtn: { disabled: false },
                    endBtn: { disabled: true }
                };
                
                this.emitSignalingLog('Info', 'Session State Update - Stop', {
                    state,
                    rtms_session_id,
                    stop_reason: stopReason,
                    ui_state: uiState
                });

                // Send stream termination message
                if (ws.readyState === 1) {
                    ws.send(JSON.stringify({
                        msg_type: MESSAGE_TYPES.RTMS_MESSAGE_TYPE.STREAM_STATE_UPDATE,
                        state: MESSAGE_TYPES.RTMS_STREAM_STATE.TERMINATED,
                        reason: stopReason,
                        timestamp: Date.now()
                    }));
                }

                broadcastMessage = {
                    msg_type: MESSAGE_TYPES.RTMS_MESSAGE_TYPE.SESSION_STATE_UPDATE,
                    rtms_session_id: rtms_session_id,
                    state: MESSAGE_TYPES.RTMS_SESSION_STATE.STOPPED,
                    ui_state: uiState,
                    timestamp: Date.now()
                };

                // Send immediately to ensure state is updated
                if (ws.readyState === 1) {
                    ws.send(JSON.stringify(broadcastMessage));
                }

                // Also broadcast to all connected clients
                if (global.signalingWebsocket && global.signalingWebsocket.readyState === 1) {
                    global.signalingWebsocket.send(JSON.stringify(broadcastMessage));
                }
                break;
        }

        // Log final state
        this.emitSignalingLog('Debug', 'Final Session State', {
            state,
            rtms_session_id,
            ui_state: uiState,
            final_message: broadcastMessage,
            timestamp: Date.now()
        });

        // Ensure the state is properly stored
        if (global.RTMSState) {
            global.RTMSState.sessionState = state;
        }
    }

    static broadcastSessionState(sessionId, state, uiState) {
        if (!global.signalingWebsocket || global.signalingWebsocket.readyState !== 1) {
            this.emitSignalingLog('Warning', 'Cannot broadcast state - no active connection');
            return;
        }

        const stateMessage = {
            msg_type: MESSAGE_TYPES.RTMS_MESSAGE_TYPE.SESSION_STATE_UPDATE,
            rtms_session_id: sessionId,
            state: state,
            ui_state: uiState,
            timestamp: Date.now()
        };

        this.emitSignalingLog('Debug', 'Broadcasting State Update', stateMessage);
        
        // Send with slight delay to ensure proper order
        setTimeout(() => {
            if (global.signalingWebsocket?.readyState === 1) {
                global.signalingWebsocket.send(JSON.stringify(stateMessage));
            }
        }, 50);
    }

    static handleKeepAliveResponse(ws, message) {
        ws.isAlive = true;
        ws.lastKeepAliveResponse = Date.now();
    }

    static emitSignalingLog(status, event, details = null) {
        if (global.logsWss) {
            global.logsWss.clients.forEach(client => {
                if (client.readyState === 1 && client.isLogsConnection) { // WebSocket.OPEN
                    client.send(JSON.stringify({
                        msg_type: MESSAGE_TYPES.RTMS_MESSAGE_TYPE.EVENT_UPDATE,
                        content: {
                            status,
                            event,
                            details,
                            timestamp: Date.now()
                        }
                    }));
                }
            });
        }
    }
}

module.exports = SignalingHandler; 