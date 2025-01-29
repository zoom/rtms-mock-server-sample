
const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();

function loadCredentials() {
    const credentialsPath = path.join(__dirname, 'data', 'rtms_credentials.json');
    try {
        return JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    } catch (error) {
        console.error('Error loading credentials:', error);
        return { auth_credentials: [], stream_meeting_info: [] };
    }
}

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

        const responseData = await response.json();
        res.json({ success: true, sent: payload, response: responseData });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            attempted_payload: payload 
        });
    }
});

module.exports = router;
