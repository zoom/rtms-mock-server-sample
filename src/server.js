
const WebSocket = require("ws");
const express = require("express");
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HANDSHAKE_PORT = 9092;
const MEDIA_STREAM_PORT = 8081;

// Express apps setup
const handshakeApp = express();
const mediaApp = express();

// HTTP servers
const handshakeServer = require("http").createServer(handshakeApp);
const mediaHttpServer = require("http").createServer(mediaApp);

// WebSocket servers
const handshakeWss = new WebSocket.Server({ server: handshakeServer });
let mediaServer = null;

// Load credentials
function loadCredentials() {
    try {
        const data = fs.readFileSync(path.join(__dirname, '../data/rtms_credentials.json'), 'utf8');
        return JSON.parse(data).credentials;
    } catch (error) {
        console.error('Error loading credentials:', error);
        return [];
    }
}

function setupMediaWebSocketServer(wss) {
    wss.on('connection', (ws, req) => {
        console.log('Media client connected');
        console.log('Connection URL:', req.url);
        const path = req.url.replace('/', '');
        
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                console.log('Media message received:', data);
                if (data.msg_type === 'DATA_HAND_SHAKE_REQ') {
                    handleDataHandshake(ws, data, path);
                }
            } catch (error) {
                console.error('Error parsing media message:', error);
            }
        });

        ws.on('close', () => {
            console.log('Media connection closed for channel:', path);
            clearAllIntervals(ws);
        });
    });
}

function setupSignalingHandshake(wss) {
    wss.on('connection', (ws) => {
        console.log('Signaling client connected');
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                console.log('Signaling message received:', data);
                
                if (data.msg_type === 'SIGNALING_HAND_SHAKE_REQ') {
                    handleSignalingHandshake(ws, data);
                }
            } catch (error) {
                console.error('Error processing signaling message:', error);
            }
        });
    });
}

function handleSignalingHandshake(ws, message) {
    const { meeting_uuid, rtms_stream_id, signature } = message;
    
    if (!meeting_uuid || !rtms_stream_id || !signature) {
        ws.send(JSON.stringify({
            msg_type: 'SIGNALING_HAND_SHAKE_RESP',
            status_code: 'STATUS_INVALID_MESSAGE'
        }));
        return;
    }

    const credentials = loadCredentials();
    const matchingCred = credentials.find(cred => 
        cred.meeting_uuid === meeting_uuid && 
        cred.rtms_stream_id === rtms_stream_id
    );

    if (!matchingCred) {
        ws.send(JSON.stringify({
            msg_type: 'SIGNALING_HAND_SHAKE_RESP',
            status_code: 'STATUS_UNAUTHORIZED'
        }));
        return;
    }

    ws.send(JSON.stringify({
        msg_type: 'SIGNALING_HAND_SHAKE_RESP',
        status_code: 'STATUS_OK',
        media_server: {
            server_urls: {
                audio: `wss://0.0.0.0:${MEDIA_STREAM_PORT}/audio`,
                video: `wss://0.0.0.0:${MEDIA_STREAM_PORT}/video`
            }
        }
    }));
}

function handleDataHandshake(ws, message, channel) {
    const { meeting_uuid, rtms_stream_id, signature } = message;

    if (!meeting_uuid || !rtms_stream_id || !signature) {
        ws.send(JSON.stringify({
            msg_type: 'DATA_HANDSHAKE_RESP',
            status_code: 'STATUS_INVALID_MESSAGE'
        }));
        return;
    }

    ws.send(JSON.stringify({
        msg_type: 'DATA_HANDSHAKE_RESP',
        status_code: 'STATUS_OK',
        sequence: Date.now(),
        payload_encrypted: false
    }));

    startMediaStreams(ws, channel);
}

function startMediaStreams(ws, channel) {
    const audioFile = path.join(__dirname, '../data/audio1241999856.pcm');
    const videoFile = path.join(__dirname, '../data/video1241999856.dfpwm');

    if (channel === 'audio' || channel === 'all') {
        if (fs.existsSync(audioFile)) {
            streamAudio(ws, audioFile);
        }
    }

    if (channel === 'video' || channel === 'all') {
        if (fs.existsSync(videoFile)) {
            streamVideo(ws, videoFile);
        }
    }
}

function streamAudio(ws, audioFile) {
    try {
        const chunks = fs.readFileSync(audioFile);
        const chunkSize = 3200;
        let chunkIndex = 0;
        const totalChunks = Math.ceil(chunks.length / chunkSize);

        const intervalId = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN && chunkIndex < totalChunks) {
                const start = chunkIndex * chunkSize;
                const end = Math.min(start + chunkSize, chunks.length);
                const chunk = chunks.slice(start, end);

                ws.send(JSON.stringify({
                    msg_type: 'MEDIA_DATA',
                    content: {
                        user_id: 0,
                        media_type: 'AUDIO',
                        data: chunk.toString('base64'),
                        timestamp: Date.now(),
                        sequence: chunkIndex
                    }
                }));

                chunkIndex++;
            } else if (chunkIndex >= totalChunks) {
                clearInterval(intervalId);
            }
        }, 100);

        ws.intervals = ws.intervals || [];
        ws.intervals.push(intervalId);
    } catch (error) {
        console.error('Error streaming audio:', error);
    }
}

function streamVideo(ws, videoFile) {
    try {
        const videoData = fs.readFileSync(videoFile);
        const chunkSize = 8192;
        let chunkIndex = 0;
        const totalChunks = Math.ceil(videoData.length / chunkSize);

        const intervalId = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN && chunkIndex < totalChunks) {
                const start = chunkIndex * chunkSize;
                const end = Math.min(start + chunkSize, videoData.length);
                const chunk = videoData.slice(start, end);

                ws.send(JSON.stringify({
                    msg_type: 'MEDIA_DATA',
                    content: {
                        user_id: 0,
                        media_type: 'VIDEO',
                        data: chunk.toString('base64'),
                        timestamp: Date.now(),
                        sequence: chunkIndex,
                        is_last: chunkIndex === totalChunks - 1
                    }
                }));

                chunkIndex++;
            } else if (chunkIndex >= totalChunks) {
                clearInterval(intervalId);
            }
        }, 33);

        ws.intervals = ws.intervals || [];
        ws.intervals.push(intervalId);
    } catch (error) {
        console.error('Error streaming video:', error);
    }
}

function clearAllIntervals(ws) {
    if (ws.intervals) {
        ws.intervals.forEach(intervalId => clearInterval(intervalId));
        ws.intervals = [];
    }
}

// HTTP routes
handshakeApp.get('/', (req, res) => res.send('RTMS Server is running'));
handshakeApp.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// Start servers
handshakeServer.listen(HANDSHAKE_PORT, '0.0.0.0', () => {
    console.log(`Handshake server running on port ${HANDSHAKE_PORT}`);
});

mediaHttpServer.listen(MEDIA_STREAM_PORT, '0.0.0.0', () => {
    console.log(`Media server running on port ${MEDIA_STREAM_PORT}`);
    mediaServer = new WebSocket.Server({ server: mediaHttpServer });
    setupMediaWebSocketServer(mediaServer);
});

// Setup signaling
setupSignalingHandshake(handshakeWss);

console.log('Starting WSS servers...');
