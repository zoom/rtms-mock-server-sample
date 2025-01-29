
const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();
router.use(express.json());

function loadCredentials() {
    const credentialsPath = path.join(__dirname, 'data', 'rtms_credentials.json');
    try {
        const data = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        // Get token from Zoom_Webhook_Secret_Token array
        const webhookToken = data.Zoom_Webhook_Secret_Token[0].token;
        return {
            auth_credentials: data.auth_credentials,
            stream_meeting_info: data.stream_meeting_info,
            webhookToken
        };
    } catch (error) {
        console.error('Error loading credentials:', error);
        return { auth_credentials: [], stream_meeting_info: [], webhookToken: '' };
    }
}

// Add webhook validation endpoint
router.post('/api/validate-webhook', async (req, res) => {
    const { webhookUrl } = req.body;
    const credentials = loadCredentials();
    const plainToken = crypto.randomBytes(16).toString('base64');
    
    try {
        const validationResponse = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                event: 'endpoint.url_validation',
                payload: {
                    plainToken: plainToken
                },
                event_ts: Date.now()
            })
        });

        if (!validationResponse.ok) {
            return res.json({ success: false, error: 'Webhook endpoint returned error' });
        }

        const data = await validationResponse.json();
        
        // Verify the response
        const expectedHash = crypto
            .createHmac('sha256', credentials.webhookToken)
            .update(plainToken)
            .digest('hex');

        if (data.plainToken === plainToken && data.encryptedToken === expectedHash) {
            res.json({ success: true });
        } else {
            res.json({ success: false, error: 'Invalid validation response' });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

function getRandomEntry(array) {
    return array[Math.floor(Math.random() * array.length)];
}

router.post('/api/send-webhook', async (req, res) => {
    const { webhookUrl } = req.body;
    const credentials = loadCredentials();
    
    // Get random credential and meeting info
    const credential = getRandomEntry(credentials.auth_credentials);
    const meetingInfo = getRandomEntry(credentials.stream_meeting_info);
    
    const payload = {
        eventType: "meeting.rtms.started",
        eventTime: Date.now(),
        clientId: credential.client_id,
        userId: credential.userID,
        accountId: credential.accountId,
        payload: {
            event: "meeting.rtms.started",
            event_ts: Date.now(),
            payload: {
                operator_id: credential.userID,
                object: {
                    meeting_uuid: meetingInfo.meeting_uuid,
                    rtms_stream_id: meetingInfo.rtms_stream_id,
                    server_urls: "wss://testzoom.replit.app"
                }
            }
        }
    };

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        let responseData;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            responseData = await response.json();
        } else {
            responseData = await response.text();
        }

        res.json({ 
            success: response.ok,
            status: response.status,
            sent: payload, 
            response: responseData 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            attempted_payload: payload 
        });
    }
});

module.exports = router;
