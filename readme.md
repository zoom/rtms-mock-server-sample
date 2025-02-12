# RTMS Mock Server

## Overview
This repo contains a mock Real-Time Media Streaming (RTMS) server that simulates WebSocket-based media streaming functionality. This server provides a complete development and testing environment for client-server interactions, including media streaming, signaling, and webhook management.

Repository: https://github.com/zoom/rtms-mock-server-sample

## Test Client
A companion test client is available to help you test this mock server. The client implements all the necessary protocols and provides a user interface for testing different streaming scenarios.

- **Repository:** [RTMS Test Client](https://github.com/zoom/rtms-mock-server-sample/blob/main/client.js)
- **Features:**
  - Webhook endpoint implementation
  - WebSocket connection handling
  - Media streaming controls
  - Incoming real time data logs

## Setup and Testing

### Prerequisites
- Option 1 (Conventional Setup):
  - Node.js (v14+)
  - FFmpeg
  - npm
  - Modern web browser with WebRTC support

- Option 2 (Docker Setup):
  - Docker
  - Modern web browser with WebRTC support

### Installation

#### Setup
```bash
# Clone repository
git clone https://github.com/zoom/rtms-mock-server-sample
cd rtms-mock-server-sample

# Install dependencies
npm install

# Start the server
npm start
```

#### Docker Setup
```bash
# Clone repository
git clone https://github.com/zoom/rtms-mock-server-sample
cd rtms-mock-server-sample

# Option 1: Using docker-compose (recommended)
docker-compose up -d

# Option 2: Manual docker commands

# Build Docker image
docker build -t rtms-mock-server .

# Run the container
docker run -d \
  -p 9092:9092 \
  -p 8081:8081 \
  -v $(pwd)/data:/app/data \
  --name rtms-mock-server \
  rtms-mock-server

# View logs
docker logs -f rtms-mock-server
```

To stop the container:
```bash
docker stop rtms-mock-server
```

To restart the container:
```bash
docker start rtms-mock-server
```

### Testing Flow

#### 1. Initial Setup
1. Start the server:
   ```bash
   npm start
   ```
2. Open `http://localhost:9092` in your browser
3. Set up your webhook receiver (example using Express):
   ```javascript
   app.post('/webhook', (req, res) => {
     const { event, payload } = req.body;
     
     // Handle URL validation
     if (event === 'endpoint.url_validation') {
       const { plainToken } = payload;
       const encryptedToken = crypto
         .createHmac('sha256', 'your_webhook_token')
         .update(plainToken)
         .digest('hex');
         
       return res.json({
         plainToken,
         encryptedToken
       });
     }
     
     // Handle meeting start events
     if (event === 'meeting.rtms.started') {
       console.log('Meeting UUID:', payload.object.meeting_uuid);
       console.log('RTMS Stream ID:', payload.object.rtms_stream_id);
       console.log('Server URLs:', payload.object.server_urls);
     }
     
     res.status(200).send();
   });
   ```

#### 2. Testing Webhook Validation
1. Start your webhook receiver (e.g., `node server.js`)
2. Enter your webhook URL in the input field (e.g., `http://your-webhook-url/webhook`)
3. Click "Validate Webhook" button
4. Check your webhook receiver logs:
   ```
   Received validation request: {
     event: "endpoint.url_validation",
     payload: { plainToken: "abc123" }
   }
   ```
5. Verify validation response in browser console:
   ```
   Webhook validated successfully
   ```

#### 3. Starting a New Meeting
1. Click "Start Meeting" button
2. Allow camera/microphone permissions when prompted
3. Your webhook receiver should get:
   ```json
   {
     "event": "meeting.rtms.started",
     "payload": {
       "operator_id": "user123",
       "object": {
         "meeting_uuid": "WLhvT3WEBT6Srse3TgWRGz",
         "rtms_stream_id": "rtms_WL3WEBT6SrTgWRGz_009",
         "server_urls": ["ws://localhost:9092/"]
       }
     }
   }
   ```

#### 4. Handling RTMS Meeting Started Webhook
When you receive the `meeting.rtms.started` webhook, follow these steps to establish connections:

##### 1. Parse Webhook Data
```javascript
app.post('/webhook', (req, res) => {
    const { event, payload } = req.body;
    
    if (event === 'meeting.rtms.started') {
        const {
            meeting_uuid,
            rtms_stream_id,
            server_urls
        } = payload.object;

        // Store these for reconnection scenarios
        connectToRTMS(meeting_uuid, rtms_stream_id, server_urls[0]);
    }
    res.status(200).send();
});
```

##### 2. Establish Connections
```javascript
async function connectToRTMS(meetingUuid, streamId, serverUrl) {
    // 1. First establish signaling connection
    const signalingSocket = new WebSocket(`${serverUrl}`);
    
    signalingSocket.onopen = () => {
        // Send handshake request
        signalingSocket.send(JSON.stringify({
            msg_type: "SIGNALING_HAND_SHAKE_REQ",
            protocol_version: 1,
            meeting_uuid: meetingUuid,
            rtms_stream_id: streamId
        }));
    };

    // 2. Handle signaling responses
    signalingSocket.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        
        if (data.msg_type === "SIGNALING_HAND_SHAKE_RESP" && 
            data.status === "STATUS_OK") {
            // Handshake successful, now connect to media
            await connectToMedia(serverUrl, meetingUuid, streamId);
        }
    };
}

// 3. Connect to media endpoints
async function connectToMedia(serverUrl, meetingUuid, streamId) {
    // Connect to all media types
    const mediaSocket = new WebSocket(`${serverUrl}/all`);
    
    // Or connect to specific media types
    const videoSocket = new WebSocket(`${serverUrl}/video`);
    const audioSocket = new WebSocket(`${serverUrl}/audio`);
    const transcriptSocket = new WebSocket(`${serverUrl}/transcript`);

    // Handle media data
    mediaSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        switch(data.msg_type) {
            case "MEDIA_DATA_VIDEO":
                handleVideoData(data.content);
                break;
            case "MEDIA_DATA_AUDIO":
                handleAudioData(data.content);
                break;
            case "MEDIA_DATA_TRANSCRIPT":
                handleTranscriptData(data.content);
                break;
        }
    };
}

// 4. Handle different media types
function handleVideoData(content) {
    const { data, timestamp, user_id } = content;
    // data is base64 encoded H.264 frame
    // Convert to Uint8Array for processing
    const videoData = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    // Process video frame...
}

function handleAudioData(content) {
    const { data, timestamp, user_id } = content;
    // data is base64 encoded PCM audio
    const audioData = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    // Process audio chunk...
}
```

##### 3. Connection States
Monitor and handle different connection states:
```javascript
function setupConnectionStateHandling(socket, type) {
    socket.onclose = (event) => {
        console.log(`${type} connection closed:`, event.code, event.reason);
        // Implement reconnection logic if needed
    };

    socket.onerror = (error) => {
        console.error(`${type} connection error:`, error);
    };

    // Keep-alive for signaling
    if (type === 'signaling') {
        setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    msg_type: "KEEP_ALIVE_REQ",
                    timestamp: Date.now()
                }));
            }
        }, 30000); // 30 seconds
    }
}
```

##### 4. Session State Updates
Send session state updates through signaling:
```javascript
function updateSessionState(socket, state, reason = null) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            msg_type: "SESSION_STATE_UPDATE",
            state: state, // "STARTED", "PAUSED", "RESUMED", "STOPPED"
            stop_reason: reason,
            timestamp: Date.now()
        }));
    }
}
```

##### 5. Reconnection Handling
```javascript
function handleReconnection(meetingUuid, streamId, serverUrl) {
    // Store connection info
    localStorage.setItem('rtmsConnection', JSON.stringify({
        meetingUuid,
        streamId,
        serverUrl,
        lastState: 'STARTED'
    }));

    // On page load/reconnect
    const savedConnection = JSON.parse(localStorage.getItem('rtmsConnection'));
    if (savedConnection) {
        connectToRTMS(
            savedConnection.meetingUuid,
            savedConnection.streamId,
            savedConnection.serverUrl
        );
    }
}
```

#### 5. Testing RTMS Controls

##### Stop/Start RTMS (Same Meeting)
1. Make sure your session is started
2. Click "Stop RTMS"
   - Stream stops
   - WebSocket closes (check Network tab)
   - "Start RTMS" button enables
3. Click "Start RTMS"
   - Your webhook receives same meeting_uuid/rtms_stream_id
   - Stream resumes with same session
   - Check webhook logs to verify IDs match

##### Pause/Resume Testing
1. During active streaming:
   - Click "Pause RTMS"
   - Verify stream pauses (video freezes)
   - Check WebSocket remains connected
2. Click "Resume RTMS"
   - Stream should continue
   - Same WebSocket connection used

##### End Meeting Verification
1. During any state (streaming/paused/stopped):
   - Click "End Meeting"
   - All connections should close
   - Check webhook receiver stops getting data

#### 6. Logs
You can see the real time logs in the logs section

#### 7. Common Testing Scenarios

##### Test Reconnection
1. Start a meeting
2. Close browser tab
3. Reopen and click "Start RTMS"
4. Verify same meeting continues

##### Test Multiple Stops/Starts
1. Start meeting
2. Stop RTMS
3. Start RTMS multiple times
4. Verify meeting_uuid remains constant

##### Test Error Handling
1. Enter invalid webhook URL
2. Start without validation
3. Stop server during streaming
4. Verify error messages appear

#### 8. WebSocket Connection Types

##### Media WebSocket Endpoints
The server provides different WebSocket endpoints for various media types:

1. **All Media** (`/all`)
   ```json
   // Video Data
   {
     "msg_type": "MEDIA_DATA_VIDEO",
     "content": {
       "user_id": 0,
       "data": "base64_encoded_video_frame",
       "timestamp": 1234567890
     }
   }

   // Audio Data
   {
     "msg_type": "MEDIA_DATA_AUDIO",
     "content": {
       "user_id": 0,
       "data": "base64_encoded_audio_chunk",
       "timestamp": 1234567890
     }
   }
   ```

2. **Video Only** (`/video`)
   - Receives only video frames
   - Format: H.264 encoded frames in base64
   - Frame rate: 30fps
   ```json
   {
     "msg_type": "MEDIA_DATA_VIDEO",
     "content": {
       "user_id": 0,
       "data": "base64_encoded_video_frame",
       "timestamp": 1234567890
     }
   }
   ```

3. **Audio Only** (`/audio`)
   - Receives only audio chunks
   - Format: PCM L16 16KHz mono
   - Chunk size: 20ms
   ```json
   {
     "msg_type": "MEDIA_DATA_AUDIO",
     "content": {
       "user_id": 0,
       "data": "base64_encoded_audio_chunk",
       "timestamp": 1234567890
     }
   }
   ```

4. **Transcript** (`/transcript`)
   - Real-time speech-to-text data
   ```json
   {
     "msg_type": "MEDIA_DATA_TRANSCRIPT",
     "content": {
       "user_id": 0,
       "data": "transcribed text",
       "timestamp": 1234567890
     }
   }
   ```

##### Testing Different Media Connections
1. Connect to specific endpoint:
   ```javascript
   // Example using browser WebSocket
   const videoWs = new WebSocket('ws://localhost:9092/video');
   const audioWs = new WebSocket('ws://localhost:9092/audio');
   const allWs = new WebSocket('ws://localhost:9092/all');
   ```

2. Handle media data:
   ```javascript
   ws.onmessage = (event) => {
     const data = JSON.parse(event.data);
     switch(data.msg_type) {
       case 'MEDIA_DATA_VIDEO':
         // Handle video frame
         break;
       case 'MEDIA_DATA_AUDIO':
         // Handle audio chunk
         break;
       case 'MEDIA_DATA_TRANSCRIPT':
         // Handle transcript
         break;
     }
   };
   ```

## System Architecture

### Backend Components

#### 1. Handshake Server (Port 9092)
- Manages initial WebSocket connections and credential validation
- Handles signaling protocols for session establishment
- **Key Endpoints:**
  - `/signaling`: WebSocket endpoint for connection handshake
  - `/health`: Server health check
  - `/ws-health`: WebSocket health status
  - `/api/*`: Webhook endpoints

#### 2. Media Server (Port 8081)
- Manages real-time media streaming with multiple channels
- **Stream Types:**
  - `/audio`: Audio-only stream
  - `/video`: Video-only stream
  - `/transcript`: Real-time transcript data
  - `/all`: Combined streams
- Handles chunked media delivery and session lifecycle

### File Structure

### File Structure
```
mockRTMSserver/
├── Dockerfile              # Docker configuration
├── .dockerignore          # Docker ignore file
├── server/
│   ├── handlers/
│   │   ├── mediaHandler.js      # Media streaming logic
│   │   ├── signalingHandler.js  # Connection handling
│   │   └── webhookHandler.js    # Webhook management
│   ├── utils/
│   │   ├── credentialsManager.js # Authentication
│   │   ├── wsUtils.js           # WebSocket utilities
│   │   └── mediaUtils.js        # Media processing
│   ├── config/
│   │   └── serverConfig.js      # Server configuration
│   └── setup/
│       └── serverSetup.js       # Server initialization
├── public/
│   ├── js/
│   │   ├── api.js              # API interactions
│   │   ├── mediaHandler.js     # Client media handling
│   │   ├── webSocket.js        # WebSocket client
│   │   └── uiController.js     # UI management
│   ├── css/
│   │   └── styles.css          # UI styling
│   └── index.html              # Main interface
├── data/                       # Credentials & media storage
└── main.js                     # Server entry point
```

## Data Formats and Protocols

### 2. WebSocket Message Formats

#### Handshake Request
```json
{
  "msg_type": "SIGNALING_HAND_SHAKE_REQ",
  "protocol_version": 1,
  "meeting_uuid": "string",
  "rtms_stream_id": "string",
  "signature": "string"
}
```

#### Media Data Format
```json
{
  "msg_type": "MEDIA_DATA_VIDEO|MEDIA_DATA_AUDIO|MEDIA_DATA_TRANSCRIPT",
  "content": {
    "user_id": "number",
    "data": "base64string",
    "timestamp": "number"
  }
}
```

#### Session State Updates
```json
{
  "msg_type": "SESSION_STATE_UPDATE",
  "session_id": "string",
  "state": "STARTED|PAUSED|RESUMED|STOPPED",
  "stop_reason": "string",
  "timestamp": "number"
}
```

## Media Handling

### 1. Supported Media Formats

#### Audio
- **Input Formats:** .m4a, .mp3
- **Processing:**
  - Converted to PCM L16 16KHz mono
  - Chunk size: 4KB
  - Streaming interval: 100ms

#### Video
- **Input Formats:** .mp4, .webm
- **Output Options:**
  - Low FPS: JPEG frames (5 FPS)
  - High FPS: H.264 stream (30 FPS)
- **Resolutions:** SD (480p), HD (720p), FHD (1080p), QHD (1440p)

### 2. Media Processing Flow
1. Client captures media (audio/video)
2. Data is converted to appropriate format
3. Chunked into specified sizes
4. Base64 encoded for transmission
5. Sent via WebSocket in defined intervals
6. Server broadcasts to appropriate subscribers

## Frontend Implementation

### 1. UI Components
- Media preview window
- Stream control buttons (Start, Stop, Pause, Resume)
- Webhook URL input and testing controls
- Stream status indicators
- Transcript display area

### 2. Client-Side Classes

#### MediaHandler
```javascript
class MediaHandler {
    static async startMediaStream(serverUrl)
    static setupVideoDisplay()
    static setupMediaRecorders()
    static setupSpeechRecognition()
    static startRecording()
    static stopRecording()
}
```

#### WebSocketHandler
```javascript
class WebSocketHandler {
    static async setupWebSocket(serverUrl)
    static handleVideoData(event)
    static handleAudioData(event)
    static sendSessionStateUpdate(state, reason)
}
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

See [LICENSE](https://github.com/zoom/rtms-mock-server-sample/blob/main/license.md) file for details.

## Support

For issues and feature requests, please create an issue in the [GitHub repository](https://github.com/zoom/rtms-mock-server-sample).

