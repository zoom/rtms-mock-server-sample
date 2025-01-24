const WebSocket = require("ws");
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

// Port configuration
const HANDSHAKE_PORT = 9092;
const MEDIA_STREAM_PORT = 8081;

// Logging function
function logWebSocketMessage(direction, type, message, path = "") {
    console.log(
        `[${new Date().toISOString()}] ${direction} ${type} ${path ? `(${path})` : ""}: `,
        typeof message === "string"
            ? message
            : JSON.stringify(message, null, 2),
    );
}

// stream start time
let streamStartTime = null;
let audioStartTime = null;

// Directory for audio and video files
const DATA_DIR = path.join(__dirname, "data");
const PCM_DIR = path.join(__dirname, "data");

// Ensure PCM directory exists
if (!fs.existsSync(PCM_DIR)) {
    fs.mkdirSync(PCM_DIR, { recursive: true });
}

// Express app and WebSocket servers
const app = express();
let mediaServer = null;
let mediaWebSocketServer;
let isHandshakeServerActive = false;
const server = require("http").createServer(app);

// Modify the server.on("upgrade") handler
server.on("upgrade", (request, socket, head) => {
    console.log("Upgrade request received for:", request.url);

    // Add more detailed logging
    console.log("Request headers:", request.headers);
    console.log("Request path:", request.url);

    if (request.url === "/signaling") {
        // Handle signaling WebSocket
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request);
        });
    } else if (
        request.url.startsWith("/audio") ||
        request.url.startsWith("/video") ||
        request.url.startsWith("/transcript") ||
        request.url.startsWith("/all")
    ) {
        // This is a media connection request
        if (mediaServer) {
            console.log(
                "Upgrading media WebSocket connection for:",
                request.url,
            );
            mediaServer.handleUpgrade(request, socket, head, (ws) => {
                mediaServer.emit("connection", ws, request);
            });
        } else {
            console.log("No media server available, closing connection");
            socket.destroy();
        }
    } else if (request.url === "/" || request.url === "") {
        // Treat root path as signaling
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request);
        });
    } else {
        console.log("Invalid WebSocket path:", request.url);
        socket.destroy();
    }
});

// Add HTTP server routes
app.get("/", (req, res) => {
    res.send("RTMS Server is running");
});

// Add health check endpoint
app.get("/health", (req, res) => {
    res.status(200).send("OK");
});

// Start HTTP server
const HTTP_PORT = process.env.PORT || 3000;
server.listen(HTTP_PORT, "0.0.0.0", () => {
    console.log(`HTTP/WebSocket server running on port ${HTTP_PORT}`);
});

// Ensure health check returns quickly
app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});

// Add WebSocket health check
app.get("/ws-health", (req, res) => {
    if (isHandshakeServerActive && mediaServer) {
        res.status(200).json({ status: "ok" });
    } else {
        res.status(503).json({ status: "error", message: "WebSocket servers not ready" });
    }
});

// Keep track of sessions and client connections
const clientSessions = new Map();
const KEEP_ALIVE_INTERVAL = 5000;
const STREAM_CHUNK_SIZE = 4096; // 4KB chunks for streaming
const AUDIO_INTERVAL_MS = 100; // Send audio data every 100ms

// Helper to generate unique sequences
let sequenceCounter = 0;
function generateSequence() {
    sequenceCounter += 1;
    return sequenceCounter;
}

// Convert a media file to PCM format
function convertToPCM(inputFile, outputFile, callback) {
    const command = `ffmpeg -y -i "${inputFile}" -f s16le -acodec pcm_s16le -ar 44100 -ac 2 "${outputFile}"`;
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error converting file ${inputFile}:`, error);
        } else {
            console.log(`Converted ${inputFile} to ${outputFile}`);
        }
        callback(error);
    });
}

// Convert all files in the data directory to PCM format
function initializePCMConversion(callback) {
    const files = fs
        .readdirSync(DATA_DIR)
        .filter((file) => file.endsWith(".m4a") || file.endsWith(".mp4"));

    let remaining = files.length;
    if (remaining === 0) {
        callback();
        return;
    }

    files.forEach((file) => {
        const inputFile = path.join(DATA_DIR, file);
        const outputFile = path.join(PCM_DIR, `${path.parse(file).name}.pcm`);
        convertToPCM(inputFile, outputFile, (error) => {
            if (--remaining === 0) {
                callback();
            }
        });
    });
}

console.log("Starting WSS servers...");

function closeMediaServer() {
    if (mediaServer) {
        mediaServer.clients.forEach((client) => {
            try {
                client.send(
                    JSON.stringify({
                        msg_type: "STREAM_STATE_UPDATE",
                        rtms_stream_id: client.rtmsStreamId,
                        state: "TERMINATED",
                        reason: "STOP_BC_CONNECTION_INTERRUPTED",
                        timestamp: Date.now(),
                    }),
                );
                client.close();
            } catch (error) {
                console.error("Error closing media client:", error);
            }
        });

        mediaServer.close(() => {
            console.log("Media server closed");
            mediaServer = null;
        });
    }
}

function startMediaServer() {
    if (!isHandshakeServerActive) {
        console.error(
            "Cannot start media server: Handshake server is not active",
        );
        return null;
    }

    if (!mediaServer) {
        mediaServer = new WebSocket.Server({
            noServer: true, // Important: Use noServer: true
            clientTracking: true,
        });

        console.log("Media WSS server is running");
        setupMediaWebSocketServer(mediaServer);

        mediaServer.on("error", (error) => {
            console.error("Media WSS server error:", error);
        });

        mediaServer.on("close", () => {
            console.log("Media server closed");
            mediaServer = null;
        });
    }
    return mediaServer;
}

// Update the handshake server to use a specific port
const wss = new WebSocket.Server({
    noServer: true,
    clientTracking: true,
});

isHandshakeServerActive = true;

wss.on("connection", (ws) => {
    console.log("New handshake connection established");

    // Handle handshake disconnection
    ws.on("close", () => {
        console.log("Handshake connection closed");
        closeMediaServer();
    });

    // Handle handshake errors
    ws.on("error", () => {
        console.log("Handshake connection error");
        closeMediaServer();
    });

    // Only start media server after successful handshake
    ws.on("message", async (data) => {
        try {
            const message = JSON.parse(data);
            logWebSocketMessage(
                "RECEIVED",
                message.msg_type,
                message,
                "signaling",
            );
            if (message.msg_type === "SIGNALING_HAND_SHAKE_REQ") {
                startMediaServer(); // Allow media server to restart if needed
                handleSignalingHandshake(ws, message);
            }
        } catch (error) {
            console.error("Error processing message:", error);
        }
    });
});

wss.on("listening", () => {
    console.log(`Handshake WSS server is running on port ${HANDSHAKE_PORT}`);
    isHandshakeServerActive = true;
});

wss.on("close", () => {
    console.log("Handshake server closed");
    isHandshakeServerActive = false;
    closeMediaServer();
});

wss.on("error", (error) => {
    console.error("Handshake WSS server error:", error);
    isHandshakeServerActive = false;
    closeMediaServer();
});

// Load and validate credentials
function loadCredentials() {
    const credentialsPath = path.join(__dirname, 'data', 'rtms_credentials.json');
    try {
        const data = fs.readFileSync(credentialsPath, 'utf8');
        return JSON.parse(data).credentials;
    } catch (error) {
        console.error('Error loading credentials:', error);
        return [];
    }
}

// Validate credentials against stored values
function validateCredentials(meeting_uuid, rtms_stream_id) {
    const credentials = loadCredentials();
    return credentials.some(cred => 
        cred.meeting_uuid === meeting_uuid && 
        cred.rtms_stream_id === rtms_stream_id
    );
}

// Signaling handshake handler
function handleSignalingHandshake(ws, message) {
    // Add version check
    if (message.protocol_version !== 1) {
        ws.send(
            JSON.stringify({
                msg_type: "SIGNALING_HAND_SHAKE_RESP",
                protocol_version: 1,
                status_code: "STATUS_INVALID_VERSION",
                reason: "Unsupported protocol version",
            }),
        );
        return;
    }

    const { meeting_uuid, rtms_stream_id, signature } = message;

    // Validate handshake request
    if (!meeting_uuid || !rtms_stream_id || !signature) {
        ws.send(
            JSON.stringify({
                msg_type: "SIGNALING_HAND_SHAKE_RESP",
                protocol_version: 1,
                status_code: "STATUS_INVALID_MESSAGE",
                reason: "Missing required fields",
            }),
        );
        return;
    }

    // Get credentials including client_id for signature validation
    const credentials = loadCredentials();
    const matchingCred = credentials.find(cred => 
        cred.meeting_uuid === meeting_uuid && 
        cred.rtms_stream_id === rtms_stream_id
    );

    if (!matchingCred) {
        ws.send(
            JSON.stringify({
                msg_type: "SIGNALING_HAND_SHAKE_RESP",
                protocol_version: 1,
                status_code: "STATUS_UNAUTHORIZED",
                reason: "Invalid credentials",
            }),
        );
        return;
    }

    // Validate signature
    const expectedSignature = crypto
        .createHmac('sha256', matchingCred.client_id)
        .update(`${meeting_uuid}${rtms_stream_id}`)
        .digest('hex');

    if (signature !== expectedSignature) {
        ws.send(
            JSON.stringify({
                msg_type: "SIGNALING_HAND_SHAKE_RESP",
                protocol_version: 1,
                status_code: "STATUS_UNAUTHORIZED",
                reason: "Invalid signature",
            }),
        );
        return;
    }

    // Store valid session
    clientSessions.set(ws, {
        meeting_uuid: meeting_uuid,
        rtms_stream_id: rtms_stream_id,
        handshakeCompleted: true,
    });

    // Get host from request headers
    const mediaHost = ws._socket.server._connectionKey.split(':')[0];

    const response = {
        msg_type: "SIGNALING_HAND_SHAKE_RESP",
        protocol_version: 1,
        status_code: "STATUS_OK",
        media_server: {
            server_urls: {
                audio: `wss://${mediaHost}/audio`,
                video: `wss://${mediaHost}/video`,
                transcript: `wss://${mediaHost}/transcript`,
                all: `wss://${mediaHost}/all`,
            },
            srtp_keys: {
                audio: crypto.randomBytes(32).toString("hex"),
                video: crypto.randomBytes(32).toString("hex"),
                share: crypto.randomBytes(32).toString("hex"),
            },
        },
    };
    console.log(
        "Sending handshake response with URLs:",
        response.media_server.server_urls,
    );
    ws.send(JSON.stringify(response));
}

// Handle event subscription
function handleEventSubscription(ws, message) {
    console.log("Handling event subscription:", message.events);
    // No response needed as per requirements
}

// Handle session state request
function handleSessionStateRequest(ws, message) {
    const { session_id } = message;

    // Mocked response for session state
    ws.send(
        JSON.stringify({
            msg_type: "SESSION_STATE_RESP",
            session_id: session_id,
            session_state: "STARTED", // Mocked state
        }),
    );
}

// Setup media WebSocket server
function setupMediaWebSocketServer(wss) {
    wss.on("connection", (ws, req) => {
        console.log("Media server connection established");
        console.log("Connection URL:", req.url);
        console.log("Connection headers:", req.headers);

        const path = req.url.replace("/", "");
        console.log(`Client connected to media channel: ${path}`);

        ws.on("message", async (data) => {
            try {
                const message = JSON.parse(data);
                console.log("Received message on media channel:", message);

                if (message.msg_type === "DATA_HAND_SHAKE_REQ") {
                    console.log(
                        "Processing DATA_HAND_SHAKE_REQ on media channel",
                    );
                    handleDataHandshake(ws, message, path);
                }
            } catch (error) {
                console.error(
                    "Error processing message on media channel:",
                    error,
                );
            }
        });

        ws.on("close", () => {
            console.log("Media connection closed for channel:", path);
            clearAllIntervals(ws);
        });
    });
}

// Data handshake handler
function handleDataHandshake(ws, message, channel) {
    // Add version check
    if (message.protocol_version !== 1) {
        ws.send(
            JSON.stringify({
                msg_type: "DATA_HANDSHAKE_RESP",
                protocol_version: 1,
                status_code: "STATUS_INVALID_VERSION",
                reason: "Unsupported protocol version",
            }),
        );
        return;
    }

    const { meeting_uuid, rtms_stream_id, payload_encryption, media_params } =
        message;

    let session = clientSessions.get(ws);
    if (!session) {
        ws.send(
            JSON.stringify({
                msg_type: "DATA_HANDSHAKE_RESP",
                protocol_version: 1,
                status_code: "STATUS_UNAUTHORIZED",
                reason: "No valid session found",
            }),
        );
        return;
    }

    // Validate credentials match session
    if (session.meeting_uuid !== meeting_uuid || session.rtms_stream_id !== rtms_stream_id) {
        ws.send(
            JSON.stringify({
                msg_type: "DATA_HANDSHAKE_RESP",
                protocol_version: 1,
                status_code: "STATUS_UNAUTHORIZED",
                reason: "Credentials do not match session",
            }),
        );
        return;
    }

    session.channel = channel;
    session.payload_encryption = payload_encryption || false;

    if (!validateMediaParams(media_params)) {
        ws.send(
            JSON.stringify({
                msg_type: "DATA_HANDSHAKE_RESP",
                protocol_version: 1,
                status_code: "STATUS_INVALID_MEDIA_PARAMS",
                reason: "Invalid media parameters",
            }),
        );
        return;
    }

    ws.send(
        JSON.stringify({
            msg_type: "DATA_HANDSHAKE_RESP",
            protocol_version: 1,
            status_code: "STATUS_OK",
            sequence: generateSequence(),
            payload_encrypted: session.payload_encryption,
        }),
    );

    startMediaStreams(ws, channel);
}

// Start streaming media data
function startMediaStreams(ws, channel) {
    const audioFile = path.join(PCM_DIR, "audio1241999856.pcm");
    const videoFile = path.join(PCM_DIR, "video1241999856.dfpwm");
    const transcriptFile = path.join(PCM_DIR, "audio1241999856.txt");

    console.log("Checking media files:");
    console.log("Audio file exists:", fs.existsSync(audioFile));
    console.log("Video file exists:", fs.existsSync(videoFile));
    console.log("Transcript file exists:", fs.existsSync(transcriptFile));
    console.log("PCM_DIR contents:", fs.readdirSync(PCM_DIR));

    if (!streamStartTime) {
        streamStartTime = Date.now();
    }

    let audioStream, videoStream;

    // Handle media streaming
    console.log("Starting media stream for channel:", channel);
    console.log("Directory contents:", fs.readdirSync(PCM_DIR));

    if (channel === "audio" || channel === "all") {
        if (fs.existsSync(audioFile)) {
            console.log("Found audio file, starting stream");
            audioStartTime = Date.now();
            streamAudio(ws, audioFile);
        } else {
            console.error("Audio PCM file not found:", audioFile);
            console.log("Looking for file:", audioFile);
        }
    }

    // Handle video streaming
    if (channel === "video" || channel === "all") {
        if (fs.existsSync(videoFile)) {
            streamVideo(ws, videoFile);
        } else {
            console.error("Video file not found:", videoFile);
        }
    }

    // Handle transcript streaming
    if (channel === "transcript" || channel === "all") {
        try {
            const transcripts = loadTranscriptsFromFile(transcriptFile);
            let transcriptIndex = 0;

            const intervalId = setInterval(() => {
                const currentTime = getCurrentPlaybackTime();

                while (
                    transcriptIndex < transcripts.length &&
                    transcripts[transcriptIndex].timestamp <= currentTime
                ) {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(
                            JSON.stringify({
                                msg_type: "TRANSCRIPT_DATA",
                                text: transcripts[transcriptIndex].text,
                                timestamp:
                                    transcripts[transcriptIndex].timestamp,
                            }),
                        );
                    }
                    transcriptIndex++;
                }

                if (transcriptIndex >= transcripts.length) {
                    clearInterval(intervalId);
                }
            }, 100); // Check every 100ms

            ws.intervals = ws.intervals || [];
            ws.intervals.push(intervalId);
        } catch (error) {
            console.error("Error streaming transcript:", error);
        }
    }

    // Cleanup on connection close
    ws.on("close", () => {
        if (audioStream) audioStream.destroy();
        if (videoStream) videoStream.destroy();
        clearAllIntervals(ws);
    });
}

// Helper functions to split up the functionality
function streamAudio(ws, audioFile) {
    console.log("Starting audio stream from:", audioFile);
    try {
        const chunks = fs.readFileSync(audioFile);
        console.log("Successfully read audio file. Size:", chunks.length);
        const chunkSize = 3200; // 100ms of 16-bit stereo audio at 16kHz
        let chunkIndex = 0;
        const totalChunks = Math.ceil(chunks.length / chunkSize);

        // Send stream state update
        sendStreamStateUpdate(ws, "ACTIVE");
        console.log(`Total audio chunks: ${totalChunks}`);

        const intervalId = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN && chunkIndex < totalChunks) {
                const start = chunkIndex * chunkSize;
                const end = Math.min(start + chunkSize, chunks.length);
                const chunk = chunks.slice(start, end);

                const message = JSON.stringify({
                    msg_type: "MEDIA_DATA",
                    content: {
                        user_id: 0,
                        media_type: "AUDIO",
                        data: chunk.toString("base64"),
                        timestamp: Date.now(),
                        sequence: chunkIndex,
                    },
                });
                console.log(
                    `Sending chunk ${chunkIndex}, size: ${chunk.length}`,
                );
                ws.send(message, (error) => {
                    if (error) console.error("Error sending chunk:", error);
                });

                chunkIndex++;
            } else if (chunkIndex >= totalChunks) {
                clearInterval(intervalId);
            }
        }, 100); // Send every 100ms

        ws.intervals = ws.intervals || [];
        ws.intervals.push(intervalId);
    } catch (error) {
        console.error("Error reading audio file:", error);
        return;
    }
}

// Add this function after streamAudio function
function streamVideo(ws, videoFile) {
    try {
        console.log("Starting video stream from:", videoFile);
        const videoData = fs.readFileSync(videoFile);
        const chunkSize = 8192; // Larger chunks for video
        let chunkIndex = 0;
        const totalChunks = Math.ceil(videoData.length / chunkSize);

        console.log(`Total video chunks: ${totalChunks}`);

        const intervalId = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN && chunkIndex < totalChunks) {
                const start = chunkIndex * chunkSize;
                const end = Math.min(start + chunkSize, videoData.length);
                const chunk = videoData.slice(start, end);

                ws.send(
                    JSON.stringify({
                        msg_type: "MEDIA_DATA",
                        content: {
                            user_id: 0,
                            media_type: "VIDEO",
                            data: chunk.toString("base64"),
                            timestamp: Date.now(),
                            sequence: chunkIndex,
                            is_last: chunkIndex === totalChunks - 1,
                        },
                    }),
                );

                chunkIndex++;
            } else if (chunkIndex >= totalChunks) {
                clearInterval(intervalId);
            }
        }, 33); // ~30fps

        ws.intervals = ws.intervals || [];
        ws.intervals.push(intervalId);
    } catch (error) {
        console.error("Error streaming video:", error);
        ws.close(1011, "Error streaming video");
    }
}

// Helper function to clean up intervals
function clearAllIntervals(ws) {
    if (ws.intervals) {
        ws.intervals.forEach((intervalId) => clearInterval(intervalId));
        ws.intervals = [];
    }
}

function loadTranscriptsFromFile(audioFile) {
    const transcriptFile = audioFile.replace(".pcm", ".txt");

    try {
        const transcriptContent = fs.readFileSync(transcriptFile, "utf-8");
        // Split by full stop and trim
        const sentences = transcriptContent
            .split(".")
            .map((sentence) => sentence.trim())
            .filter((sentence) => sentence.length > 0);

        return sentences.map((sentence, index) => ({
            timestamp: index * 2000, // Assuming each sentence is roughly 2 seconds apart
            text: sentence + ".", // Add back the full stop
        }));
    } catch (error) {
        console.error("Error reading transcript file:", error);
        return [];
    }
}

function getCurrentPlaybackTime() {
    if (!streamStartTime) return 0;
    return Date.now() - streamStartTime;
}

// Keep-alive messages
function sendKeepAlive(ws) {
    const keepAliveInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(
                JSON.stringify({
                    msg_type: "KEEP_ALIVE_REQ",
                    sequence: generateSequence(),
                    timestamp: Date.now(),
                }),
            );
        } else {
            clearInterval(keepAliveInterval);
        }
    }, KEEP_ALIVE_INTERVAL);
}

function cleanupConnection(ws) {
    clientSessions.delete(ws);
    if (ws.intervals) {
        ws.intervals.forEach((intervalId) => clearInterval(intervalId));
        ws.intervals = [];
    }
    try {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    } catch (error) {
        console.error("Error closing WebSocket:", error);
    }
}

// Add stream state update handling
function sendStreamStateUpdate(ws, state, reason = null) {
    ws.send(
        JSON.stringify({
            msg_type: "STREAM_STATE_UPDATE",
            rtms_stream_id: ws.rtmsStreamId,
            state: state, // ACTIVE|TERMINATED
            reason: reason, // STOP_BC_MEETING_ENDED, etc.
            timestamp: Date.now(),
        }),
    );
}

// Add event update handling for active speaker
function sendActiveSpeakerUpdate(ws, currentId, newId, name) {
    ws.send(
        JSON.stringify({
            msg_type: "EVENT_UPDATE",
            event: {
                event_type: "ACTIVE_SPEAKER_CHANGE",
                current_id: currentId, // 0|11223344 (0 means first speaker)
                new_id: newId,
                name: name,
                timestamp: Date.now(),
            },
        }),
    );
}

// Add participant join event handling
function sendParticipantJoinEvent(ws, participants) {
    ws.send(
        JSON.stringify({
            msg_type: "EVENT_UPDATE",
            event: {
                event_type: "PARTICIPANT_JOIN",
                participants: participants, // Array of {user_id: number, name: string}
            },
        }),
    );
}

// Add participant leave event handling
function sendParticipantLeaveEvent(ws, participantIds) {
    ws.send(
        JSON.stringify({
            msg_type: "EVENT_UPDATE",
            event: {
                event_type: "PARTICIPANT_LEAVE",
                participants: participantIds, // Array of user_ids
            },
        }),
    );
}

// Add session state update handling
function sendSessionStateUpdate(ws, sessionId, state, stopReason = null) {
    ws.send(
        JSON.stringify({
            msg_type: "SESSION_STATE_UPDATE",
            session_id: sessionId,
            state: state, // STARTED|PAUSED|RESUMED|STOPPED
            stop_reason: stopReason, // Only included if state is STOPPED
            timestamp: Date.now(),
        }),
    );
}

// Add media data audio message handling
function sendMediaDataAudio(ws, userId, audioData) {
    ws.send(
        JSON.stringify({
            msg_type: "MEDIA_DATA_AUDIO",
            content: {
                user_id: userId, // 0 means mixed audio
                data: audioData,
                timestamp: Date.now(),
            },
        }),
    );
}

// Add media data video message handling
function sendMediaDataVideo(ws, userId, videoData) {
    ws.send(
        JSON.stringify({
            msg_type: "MEDIA_DATA_VIDEO",
            content: {
                user_id: userId,
                data: videoData,
            },
        }),
    );
}

// Add transcript data message handling
function sendTranscriptData(ws, userId, transcriptText) {
    ws.send(
        JSON.stringify({
            msg_type: "MEDIA_DATA_TRANSCRIPT",
            content: {
                user_id: userId,
                timestamp: Date.now(),
                data: transcriptText,
            },
        }),
    );
}

const RTMS_STOP_REASON = {
    UNKNOWN: "UNKNOWN",
    STOP_BC_HOST_TRIGGERED: "STOP_BC_HOST_TRIGGERED",
    STOP_BC_USER_TRIGGERED: "STOP_BC_USER_TRIGGERED",
    STOP_BC_USER_LEFT: "STOP_BC_USER_LEFT",
    STOP_BC_USER_EJECTED: "STOP_BC_USER_EJECTED",
    STOP_BC_APP_DISABLED_BY_HOST: "STOP_BC_APP_DISABLED_BY_HOST",
    STOP_BC_MEETING_ENDED: "STOP_BC_MEETING_ENDED",
    STOP_BC_STREAM_CANCELED: "STOP_BC_STREAM_CANCELED",
    STOP_BC_ALL_APPS_DISABLED: "STOP_BC_ALL_APPS_DISABLED",
    STOP_BC_INTERNAL_EXCEPTION: "STOP_BC_INTERNAL_EXCEPTION",
    STOP_BC_CONNECTION_TIMEOUT: "STOP_BC_CONNECTION_TIMEOUT",
    STOP_BC_CONNECTION_INTERRUPTED: "STOP_BC_CONNECTION_INTERRUPTED",
    STOP_BC_CONNECTION_CLOSED_BY_CLIENT: "STOP_BC_CONNECTION_CLOSED_BY_CLIENT",
    STOP_BC_EXIT_SIGNAL: "STOP_BC_EXIT_SIGNAL",
};

// Message Types
const RTMS_MESSAGE_TYPE = {
    UNKNOWN: "UNKNOWN",
    SIGNALING_HANDSHAKE_REQ: "SIGNALING_HANDSHAKE_REQ",
    SIGNALING_HANDSHAKE_RESP: "SIGNALING_HANDSHAKE_RESP",
    DATA_HANDSHAKE_REQ: "DATA_HANDSHAKE_REQ",
    DATA_HANDSHAKE_RESP: "DATA_HANDSHAKE_RESP",
    EVENT_SUBSCRIPTION: "EVENT_SUBSCRIPTION",
    EVENT_UPDATE: "EVENT_UPDATE",
    STREAM_STATE_UPDATE: "STREAM_STATE_UPDATE",
    SESSION_STATE_UPDATE: "SESSION_STATE_UPDATE",
    SESSION_STATE_REQ: "SESSION_STATE_REQ",
    SESSION_STATE_RESP: "SESSION_STATE_RESP",
    KEEP_ALIVE_REQ: "KEEP_ALIVE_REQ",
    KEEP_ALIVE_RESP: "KEEP_ALIVE_RESP",
    MEDIA_DATA_AUDIO: "MEDIA_DATA_AUDIO",
    MEDIA_DATA_VIDEO: "MEDIA_DATA_VIDEO",
    MEDIA_DATA_SHARE: "MEDIA_DATA_SHARE",
    MEDIA_DATA_CHAT: "MEDIA_DATA_CHAT",
    MEDIA_DATA_TRANSCRIPT: "MEDIA_DATA_TRANSCRIPT",
};

// Event Types
const RTMS_EVENT_TYPE = {
    ACTIVE_SPEAKER_CHANGE: "ACTIVE_SPEAKER_CHANGE",
    PARTICIPANT_JOIN: "PARTICIPANT_JOIN",
    PARTICIPANT_LEAVE: "PARTICIPANT_LEAVE",
};

// Session States
const RTMS_SESSION_STATE = {
    INACTIVE: "INACTIVE",
    INITIALIZE: "INITIALIZE",
    STARTED: "STARTED",
    PAUSED: "PAUSED",
    RESUMED: "RESUMED",
    STOPPED: "STOPPED",
};

// Stream States
const RTMS_STREAM_STATE = {
    INACTIVE: "INACTIVE",
    ACTIVE: "ACTIVE",
    TERMINATED: "TERMINATED",
    INTERRUPTED: "INTERRUPTED",
};

// Media Types
const MEDIA_DATA_TYPE = {
    AUDIO: 1,
    VIDEO: 2,
    DESKSHARE: 3,
    TRANSCRIPT: 4,
    CHAT: 5,
    ALL: 6,
};

// Media Content Types
const MEDIA_CONTENT_TYPE = {
    RTP: 1,
    RAW_AUDIO: 2,
    RAW_VIDEO: 3,
    FILE_STREAM: 4,
    TEXT: 5,
};

// Default Media Parameters
const DEFAULT_AUDIO_PARAMS = {
    content_type: MEDIA_CONTENT_TYPE.RAW_AUDIO,
    sample_rate: "SR_16K",
    channel: "MONO",
    codec: "L16",
    data_opt: "AUDIO_MIXED_STREAM",
    send_interval: 20,
};

const DEFAULT_VIDEO_PARAMS = {
    content_type: MEDIA_CONTENT_TYPE.RAW_VIDEO,
    codec: "JPG",
    resolution: "HD",
    fps: 5,
};

function validateMediaParams(params) {
    if (!params) return false;

    if (params.audio) {
        // Validate audio content type
        if (params.audio.content_type !== MEDIA_CONTENT_TYPE.RAW_AUDIO) return false;

        // Validate sample rate
        if (!['SR_16K', 'SR_32K', 'SR_48K'].includes(params.audio.sample_rate)) return false;

        // Validate channel
        if (!['MONO', 'STEREO'].includes(params.audio.channel)) return false;

        // Validate codec
        if (!['L16', 'PCMA', 'PCMU', 'G722', 'OPUS'].includes(params.audio.codec)) return false;

        // Validate data option
        if (!['AUDIO_MIXED_STREAM', 'AUDIO_MULTI_STREAMS'].includes(params.audio.data_opt)) return false;

        // Validate send interval
        if (params.audio.send_interval && (params.audio.send_interval % 20 !== 0)) return false;
    }

    if (params.video) {
        // Validate content type
        if (params.video.content_type !== MEDIA_CONTENT_TYPE.RAW_VIDEO) return false;

        // Validate codec based on fps
        if (params.video.fps <= 5 && params.video.codec !== 'JPG') return false;
        if (params.video.fps > 5 && params.video.codec !== 'H264') return false;

        // Validate resolution
        if (!['SD', 'HD', 'FHD', 'QHD'].includes(params.video.resolution)) return false;

        // Validate fps range
        if (typeof params.video.fps !== 'number' || params.video.fps < 1 || params.video.fps > 30) return false;
    }

    return true;
}