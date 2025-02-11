class APIHandler {
    static async validateWebhook() {
        try {
            const webhookUrl = document.getElementById("webhookUrl").value;
            UIController.addSystemLog('Webhook', 'Validation request sent', { url: webhookUrl });

            const response = await fetch("/api/validate-webhook", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ webhookUrl }),
            });

            const data = await response.json();

            if (data.success) {
                UIController.addSystemLog('Webhook', 'Validation successful');
                // Enable the start meeting button
                document.getElementById("sendBtn").disabled = false;
                // Store the validated URL for later use
                window.validatedWebhookUrl = webhookUrl;
            } else {
                UIController.addSystemLog('Webhook', 'Validation failed', { error: data.error });
                document.getElementById("sendBtn").disabled = true;
                window.validatedWebhookUrl = null;
            }
        } catch (error) {
            console.error("Validation error:", error);
            UIController.addSystemLog('Webhook', 'Validation error', { error: error.message });
            document.getElementById("sendBtn").disabled = true;
            window.validatedWebhookUrl = null;
        }
    }

    static async sendWebhook() {
        try {
            // Use the stored validated URL
            const webhookUrl = window.validatedWebhookUrl || document.getElementById("webhookUrl").value;
            UIController.addSignalingLog('Sending Meeting Start Request', { webhookUrl });

            const response = await fetch("/api/send-webhook", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ webhookUrl }),
            });

            const data = await response.json();
            
            if (data.success && data.sent?.payload?.payload?.object?.server_urls) {
                UIController.addSignalingLog('Meeting Start Success', {
                    server_urls: data.sent.payload.payload.object.server_urls
                });
                await MediaHandler.startMediaStream(data.sent.payload.payload.object.server_urls);
            } else {
                UIController.addSignalingLog('Meeting Start Failed', data);
                document.getElementById("sendBtn").disabled = true;
            }
        } catch (error) {
            UIController.addSignalingLog('Meeting Start Error', { error: error.message });
            console.error("Send webhook error:", error);
            document.getElementById("sendBtn").disabled = true;
        }
    }
} 