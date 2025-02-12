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
         "meeting_uuid": "meeting_uuid",
         "rtms_stream_id": "rtms_stream_id",
         "server_urls": ["ws://localhost:9092"]
       }
     }
   }
   ```
4. Verify in browser:
   - Video preview appears
   - WebSocket connections established (check Network tab)
   - Buttons update (Pause/Stop/End enabled)

#### 4. Testing RTMS Controls

##### Stop/Start RTMS (Same Meeting)
1. Start streaming some media
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
   - UI resets completely
   - Check webhook receiver stops getting data

#### 5. Verifying Data Flow
1. Open browser DevTools (F12)
2. Network tab > WS filter
3. You should see:
   - Signaling connection (/signaling)
   - Media connection (/all)
4. Click messages to verify format:
   ```json
   {
     "msg_type": "MEDIA_DATA_VIDEO",
     "content": {
       "user_id": 0,
       "data": "base64_encoded_data",
       "timestamp": 1234567890
     }
   }
   ```

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
