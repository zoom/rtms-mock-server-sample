# RTMS Mock Server

## Overview
This repo contains a Mock Realtime Media Streaming (RTMS) server that emulates the capabilities of the [Zoom Realtime Media Streaming Server](https://developers.zoom.us/blog/realtime-media-streams/) . This server provides a complete development and testing environment for client-server interactions, including media streaming, signaling, and webhook management.

Repository: https://github.com/zoom/rtms-mock-server-sample

## Test Client
A companion test client is available to help you test this mock server. The client implements all the necessary protocols and provides a user interface for testing different streaming scenarios.

- **Repository:** [RTMS Test Client](https://github.com/zoom/rtms-mock-server-sample/test_client)
- **Features:**
  - Webhook endpoint implementation
  - WebSocket connection handling
  - Media streaming controls
  - Incoming real time data logs
 
  - Steps to implementing the client can be found [here](https://github.com/zoom/rtms-mock-server-sample/blob/main/test_client/client_readme.md)

## Setup and Testing the RTMS Mock Server

### Prerequisites

- Option 1 (Conventional Setup):
  - Node.js (v14+)
  - FFmpeg
  - npm

- Option 2 (Docker Setup):
  - Docker

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
1. Start the server
2. Open `http://localhost:9092` in your browser
3. Set up your webhook receiver to handle these payloads:

**URL Validation Webhook Payload:**
```json
{
  "event": "endpoint.url_validation",
  "payload": {
    "plainToken": "abc123"
  }
}
```

**Expected URL Validation Response:**
```json
{
  "plainToken": "abc123",
  "encryptedToken": "encrypted_token_hash"
}
```

**Meeting Started Webhook Payload:**
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

#### 2. WebSocket Message Formats

**Handshake Request (Client → Server):**
```json
{
  "msg_type": "SIGNALING_HAND_SHAKE_REQ",
  "protocol_version": 1,
  "meeting_uuid": "meeting_uuid",
  "rtms_stream_id": "stream_id",
  "signature": "hmac_sha256_signature"
}
```

**Note:** The `signature` field should be generated using HMAC-SHA256 with the following pattern:
```
signature = HMAC-SHA256(
    key: your_webhook_token,
    message: meeting_uuid + rtms_stream_id
)
```

**Handshake Response (Server → Client):**
```json
{
  "msg_type": "SIGNALING_HAND_SHAKE_RESP",
  "status": "STATUS_OK",
  "media_urls": {
    "all": "ws://localhost:8081/all",
    "video": "ws://localhost:8081/video",
    "audio": "ws://localhost:8081/audio",
    "transcript": "ws://localhost:8081/transcript"
  }
}
```

**Keep-Alive Request (Server → Client):**
```json
{
  "msg_type": "KEEP_ALIVE_REQ",
  "timestamp": 1234567890
}
```

**Keep-Alive Response (Client → Server):**
```json
{
  "msg_type": "KEEP_ALIVE_RESP",
  "timestamp": 1234567890
}
```

**Session State Update:**
```json
{
  "msg_type": "SESSION_STATE_UPDATE",
  "state": "STARTED", // or "PAUSED", "RESUMED", "STOPPED"
  "stop_reason": "reason",
  "timestamp": 1234567890
}
```

#### 3. Media WebSokcet Message Formats

**Video Data Format:**
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

**Audio Data Format:**
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

**Transcript Data Format:**
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

#### 4. Testing RTMS Controls

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

#### 5. Logs
You can see the real time logs in the logs section

#### 6. Common Testing Scenarios

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

## System Architecture

### Backend Components

#### 1. Handshake Server (Port 9092)
- Manages initial WebSocket connections and credential validation
- Handles signaling protocols for session establishment


#### 2. Media Server (Port 8081)
- Manages real-time media streaming with multiple channels
- **Stream Types:**
  - `/audio`: Audio-only stream
  - `/video`: Video-only stream
  - `/transcript`: Real-time transcript data
  - `/all`: Combined streams
- Handles chunked media delivery and session lifecycle

### File Structure
```
mockRTMSserver/
├── Dockerfile              # Docker configuration
├── .dockerignore          # Docker ignore file
├── server/
│   ├── handlers/
│   │   ├── mediaHandler.js      # Media streaming logic
│   │   ├── wsHandler.js         # WebSocket handling
│   │   ├── signalingHandler.js  # Signaling logic
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
│   │   ├── audio-processor.js  # Audio processing
│   │   └── uiController.js     # UI management
│   ├── css/
│   │   └── styles.css          # UI styling
│   └── index.html              # Main interface
├── data/                       # Credentials & media storage
├── package.json               # Dependencies
└── main.js                    # Server entry point
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

### UI Components

#### Control Buttons
- **Webhook Controls**
  - Webhook URL input field
  - Validate button with status indicator

- **Meeting Controls**
  - Start Meeting 
  - Pause RTMS 
  - Resume RTMS 
  - Stop RTMS 
  - Start RTMS 
  - End Meeting 

#### Sidebar
- **Tab Navigation**
  - Transcripts tab
  - Logs tab

- **Display Areas**
  - Transcript container
    - Real-time speech-to-text display
    - Timestamp for each entry
  - System logs container
    - Signaling events
    - Connection status
    - Media stream status
    - Error messages

## License

See [LICENSE](https://github.com/zoom/rtms-mock-server-sample/blob/main/license.md) file for details.

## Support

For issues and feature requests, please create an issue in the [GitHub repository](https://github.com/zoom/rtms-mock-server-sample).

