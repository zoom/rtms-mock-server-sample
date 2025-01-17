const WebSocket = require('ws');
const express = require('express');
const crypto = require('crypto');

const app = express();
const server = app.listen(8081, () => {
    console.log('RTMS server running on port 8081');
});

const wss = new WebSocket.Server({ server });

// Keep track of sessions and client connections
const clientSessions = new Map();
const KEEP_ALIVE_INTERVAL = 5000;

// Helper to generate unique sequences
let sequenceCounter = 0;
function generateSequence() {
    sequenceCounter += 1;
    return sequenceCounter;
}

// Helper to generate signature
function generateSignature(clientId, meetingUuid, rtmsStreamId, secret) {
    const message = `${clientId},${meetingUuid},${rtmsStreamId}`;
    return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

// Handle incoming WebSocket connections
wss.on('connection', (ws, req) => {
    console.log(`New WebSocket connection on path: ${req.url}`);

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            console.log('Received:', message);

            switch (message.msg_type) {
                case 'SIGNALING_HAND_SHAKE_REQ':
                    handleSignalingHandshake(ws, message);
                    break;
                case 'DATA_HAND_SHAKE_REQ':
                    handleDataHandshake(ws, message);
                    break;
                case 'KEEP_ALIVE_RESP':
                    console.log('Keep-alive response received from client.');
                    break;
                default:
                    console.error('Unknown message type:', message.msg_type);
            }
        } catch (error) {
            console.error('Error processing message:', error.message);
        }
    });

    ws.on('close', () => {
        console.log('Connection closed');
        clientSessions.delete(ws);
    });

    sendKeepAlive(ws);
});

// Signaling handshake handler
function handleSignalingHandshake(ws, message) {
    const { meeting_uuid, rtms_stream_id, signature } = message;

    if (!meeting_uuid || !rtms_stream_id || !signature) {
        ws.send(JSON.stringify({
            msg_type: 'SIGNALING_HAND_SHAKE_RESP',
            protocol_version: 1,
            status_code: 'STATUS_INVALID_MESSAGE',
            reason: 'Missing required fields'
        }));
        return;
    }

    clientSessions.set(ws, { meeting_uuid, rtms_stream_id, handshakeCompleted: true });

    ws.send(JSON.stringify({
        msg_type: 'SIGNALING_HAND_SHAKE_RESP',
        protocol_version: 1,
        status_code: 'STATUS_OK',
        media_server: {
            server_urls: {
                audio: 'wss://localhost:8081/audio',
                video: 'wss://localhost:8081/video',
                transcript: 'wss://localhost:8081/transcript'
            },
            srtp_keys: {
                audio: crypto.randomBytes(32).toString('hex'),
                video: crypto.randomBytes(32).toString('hex'),
                share: crypto.randomBytes(32).toString('hex')
            }
        }
    }));
}

// Data handshake handler
function handleDataHandshake(ws, message) {
    const { meeting_uuid, rtms_stream_id, media_type, payload_encryption, media_params } = message;

    const session = clientSessions.get(ws);
    if (!session || session.meeting_uuid !== meeting_uuid || session.rtms_stream_id !== rtms_stream_id) {
        ws.send(JSON.stringify({
            msg_type: 'DATA_HAND_SHAKE_RESP',
            status_code: 'STATUS_INVALID_MEETING_OR_STREAM_ID',
            reason: 'Invalid meeting or stream ID'
        }));
        return;
    }

    if (!media_type) {
        ws.send(JSON.stringify({
            msg_type: 'DATA_HAND_SHAKE_RESP',
            status_code: 'STATUS_NO_MEDIA_TYPE_SPECIFIED',
            reason: 'No media type specified'
        }));
        return;
    }

    session.media_type = media_type;
    session.media_params = media_params || {};
    session.payload_encryption = payload_encryption || false;

    ws.send(JSON.stringify({
        msg_type: 'DATA_HAND_SHAKE_RESP',
        protocol_version: 1,
        status_code: 'STATUS_OK',
        sequence: generateSequence(),
        payload_encrypted: session.payload_encryption,
        media_params: {
            audio: {
                content_type: 'RAW_AUDIO',
                sample_rate: 'SR_16K',
                channel: 'MONO',
                codec: 'L16',
                data_opt: 'AUDIO_MIXED_STREAM',
                send_interval: 100
            },
            video: {
                content_type: 'RAW_VIDEO',
                codec: 'H264',
                resolution: 'HD',
                fps: 24
            },
            transcript: {
                content_type: 'TEXT'
            }
        }
    }));

    startMediaStreams(ws, media_type);
}

// Start streaming media data
function startMediaStreams(ws, media_type) {
    const streamInterval = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) {
            clearInterval(streamInterval);
            return;
        }

        if (media_type === 'AUDIO' || media_type === 'ALL') {
            ws.send(JSON.stringify({
                msg_type: 'MEDIA_DATA_AUDIO',
                content: {
                    user_id: 0, // Mixed stream
                    data: Buffer.from('mock_audio_data').toString('base64'),
                    timestamp: Date.now()
                }
            }));
        }

        if (media_type === 'VIDEO' || media_type === 'ALL') {
            ws.send(JSON.stringify({
                msg_type: 'MEDIA_DATA_VIDEO',
                content: {
                    user_id: 16778240, // Sample user ID
                    data: Buffer.from('mock_video_data').toString('base64'),
                    timestamp: Date.now()
                }
            }));
        }

        if (media_type === 'TRANSCRIPT' || media_type === 'ALL') {
            ws.send(JSON.stringify({
                msg_type: 'MEDIA_DATA_TRANSCRIPT',
                content: {
                    user_id: 19778240, // Sample user ID
                    data: 'This is a sample transcript message',
                    timestamp: Date.now()
                }
            }));
        }
    }, 1000); // Stream every second
}

// Keep-alive messages
function sendKeepAlive(ws) {
    const keepAliveInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                msg_type: 'KEEP_ALIVE_REQ',
                sequence: generateSequence(),
                timestamp: Date.now()
            }));
        } else {
            clearInterval(keepAliveInterval);
        }
    }, KEEP_ALIVE_INTERVAL);
}
