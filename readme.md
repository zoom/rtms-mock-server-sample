# RTMS Mock Server

## Overview
A comprehensive mock Real-Time Media Streaming (RTMS) server that simulates WebSocket-based media streaming functionality. This server provides a complete development and testing environment for client-server interactions, including media streaming, signaling, and webhook management.

Repository: https://github.com/ojusave/mockRTMSserver

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
```
mockRTMSserver/
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

### 1. Credential Format
```json
{
  "auth_credentials": [
    {
      "client_id": "your_client_id",
      "client_secret": "your_client_secret",
      "userID": "your_user_id",
      "accountId": "your_account_id"
    }
  ],
  "stream_meeting_info": [
    {
      "meeting_uuid": "meeting_uuid",
      "rtms_stream_id": "stream_id"
    }
  ],
  "Zoom_Webhook_Secret_Token": [
    {
      "token": "your_webhook_token"
    }
  ]
}
```

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

## Setup and Usage

### Prerequisites
- Node.js (v14+)
- FFmpeg
- npm
- Modern web browser with WebRTC support

### Installation
```bash
# Clone repository
git clone https://github.com/ojusave/mockRTMSserver
cd mockRTMSserver

# Install dependencies
npm install

# Create required directories
mkdir -p data uploads

# Configure credentials
cp config/credentials.example.json data/rtms_credentials.json
```

### Testing Flow

1. **Access Dashboard**
   - Open `http://localhost:9092` in your browser
   - Enter webhook URL in the testing interface

2. **Validate Webhook**
   ```bash
   curl -X POST http://localhost:9092/api/validate-webhook \
     -H "Content-Type: application/json" \
     -d '{"webhookUrl": "your_webhook_url"}'
   ```

3. **Start Media Stream**
   - Click "Send Webhook" to initiate session
   - Allow camera/microphone access when prompted
   - Use the control panel to manage the stream

4. **Monitor Data Flow**
   - Check browser console for WebSocket messages
   - Monitor server logs for connection status
   - Verify media transmission in preview window

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
