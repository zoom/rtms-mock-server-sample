# RTMS Mock Server

## Overview
This repo contains a mock Real-Time Media Streaming (RTMS) server that simulates WebSocket-based media streaming functionality. This server provides a complete development and testing environment for client-server interactions, including media streaming, signaling, and webhook management.

Repository: https://github.com/zoom/rtms-mock-server-sample

## Test Client
A companion test client is available to help you test this mock server. The client implements all the necessary protocols and provides a user interface for testing different streaming scenarios.

- **Repository:** [RTMS Test Client](https://github.com/ojusave/rtmsTestClient)
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

#### Conventional Setup
```bash
# Clone repository
git clone https://github.com/zoom/rtms-mock-server-sample
cd mockRTMSserver

# Install dependencies
npm install

# Create data directory for credentials and media files
mkdir data

# Configure credentials
cp config/credentials.example.json data/rtms_credentials.json
```

#### Docker Setup
```bash
# Clone repository
git clone https://github.com/zoom/rtms-mock-server-sample
cd mockRTMSserver

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
3. You should see the testing dashboard with:
   - Webhook URL input field
   - "Validate Webhook" button
   - "Send Webhook" button
   - Media preview area
   - Stream control buttons

#### 2. Webhook Validation
1. Enter your webhook URL in the input field
2. Click "Validate Webhook" button
3. The server will send a validation request to your webhook endpoint:
   ```json
   {
     "event": "endpoint.url_validation",
     "payload": {
       "plainToken": "randomToken"
     },
     "event_ts": 1234567890
   }
   ```
4. Your webhook receiver should:
   - Extract the plainToken
   - Create HMAC-SHA256 hash using your webhook token
   - Return response:
     ```json
     {
       "plainToken": "same_random_token",
       "encryptedToken": "hmac_hash_of_token"
     }
     ```
5. Wait for validation success message

#### 3. Start Streaming Session
1. After successful validation, click "Send Webhook"
2. The server will send a webhook with streaming URLs:
   ```json
   {
     "event": "meeting.rtms.started",
     "payload": {
       "operator_id": "user_id",
       "object": {
         "meeting_uuid": "meeting_id",
         "rtms_stream_id": "stream_id",
         "server_urls": ["ws://localhost:9092/signaling"]
       }
     }
   }
   ```
3. Your client should:
   - Generate HMAC signature:
     ```javascript
     const message = `${client_id}${meeting_uuid}${rtms_stream_id}`;
     const signature = crypto
       .createHmac('sha256', client_secret)
       .update(message)
       .digest('hex');
     ```
   - Send handshake request to the signaling server:
     ```json
     {
       "msg_type": "SIGNALING_HAND_SHAKE_REQ",
       "protocol_version": 1,
       "meeting_uuid": "meeting_uuid",
       "rtms_stream_id": "stream_id",
       "signature": "generated_signature"
     }
     ```
   - Receive media server URLs in response:
     ```json
     {
       "msg_type": "SIGNALING_HAND_SHAKE_RESP",
       "status_code": "STATUS_OK",
       "media_server": {
         "server_urls": {
           "audio": "ws://localhost:8081/audio",
           "video": "ws://localhost:8081/video",
           "transcript": "ws://localhost:8081/transcript",
           "all": "ws://localhost:8081/all"
         }
       }
     }
     ```

#### 4. Media Socket Connections
1. Based on your streaming needs, connect to one or more media sockets:
   - `/audio`: For audio-only streaming
   - `/video`: For video-only streaming
   - `/transcript`: For real-time transcription
   - `/all`: For all media types

2. Each socket serves a specific purpose:
   - Audio Socket:
     - Receives PCM audio data (16KHz, mono)
     - Handles audio state updates
     - Reports audio statistics

   - Video Socket:
     - Receives H.264/JPEG video frames
     - Manages video quality settings
     - Reports video statistics

   - Transcript Socket:
     - Receives real-time transcription data
     - Handles language settings
     - Reports transcription status

   - All-in-One Socket:
     - Handles all media types
     - Requires message type identification
     - Suitable for simplified implementations

#### 5. Media Streaming
1. When prompted, allow camera/microphone access
2. The client will:
   - Connect to media WebSocket endpoints
   - Start sending audio/video/transcript data
   - Format data according to specifications:
     ```json
     {
       "msg_type": "MEDIA_DATA_VIDEO",
       "content": {
         "user_id": 123,
         "data": "base64_encoded_video_frame",
         "timestamp": 1234567890
       }
     }
     ```
3. Use stream controls:
   - Pause/Resume: Temporarily stop/restart streaming
   - Stop: End the streaming session
   - Mute: Toggle audio streaming
   - Video Off: Toggle video streaming
   - Each control action sends appropriate state updates:
     ```json
     {
       "msg_type": "SESSION_STATE_UPDATE",
       "state": "PAUSED",
       "timestamp": 1234567890
     }
     ```

#### 6. Monitoring
1. Browser Console (F12):
   - WebSocket connection status
   - Message events
   - Media stream status
2. Server Logs:
   - Connection events
   - Data flow status
   - Error messages
3. Preview Window:
   - Local video preview
   - Audio level indicators
   - Connection status indicators

#### 7. Cleanup
1. Click "Stop" to end streaming
2. Server will:
   - Send termination events
   - Close WebSocket connections
   - Clean up resources
3. Verify all connections are closed in browser console

### Common Issues and Solutions

1. **WebSocket Connection Fails**
   - Verify server is running on correct ports
   - Check credentials in rtms_credentials.json
   - Ensure proper CORS configuration

2. **Media Stream Issues**
   - Verify camera/microphone permissions
   - Check supported media formats
   - Monitor browser console for errors

3. **Webhook Testing Fails**
   - Verify webhook URL is accessible
   - Check webhook token configuration
   - Ensure proper request format

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

MIT License - see LICENSE file for details

## Support

For issues and feature requests, please create an issue in the [GitHub repository](https://github.com/ojusave/mockRTMSserver/issues).
