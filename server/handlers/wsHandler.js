const WebSocket = require("ws");
const WebSocketUtils = require('../utils/wsUtils');
const SignalingHandler = require('./signalingHandler');
const MediaHandler = require('./mediaHandler');

class WSHandler {
    static setupWebSocketServer(server) {
        const wss = new WebSocket.Server({
            noServer: true,
            clientTracking: true,
        });

        wss.on("connection", this.handleConnection);
        wss.on("error", this.handleError);
        wss.on("close", this.handleClose);

        return wss;
    }

    static handleUpgrade(request, socket, head) {
        WebSocketUtils.handleSocketError(socket);
        console.log("Upgrade request received for:", request.url);

        if (request.url === "/signaling") {
            global.wss.handleUpgrade(request, socket, head, (ws) => {
                global.wss.emit("connection", ws, request);
            });
        } else if (this.isMediaPath(request.url)) {
            if (global.mediaServer) {
                global.mediaServer.handleUpgrade(request, socket, head, (ws) => {
                    global.mediaServer.emit("connection", ws, request);
                });
            } else {
                socket.destroy();
            }
        } else if (request.url === "/" || request.url === "") {
            global.wss.handleUpgrade(request, socket, head, (ws) => {
                global.wss.emit("connection", ws, request);
            });
        } else {
            console.log("Invalid WebSocket path:", request.url);
            socket.destroy();
        }
    }

    static isMediaPath(url) {
        return url.startsWith("/audio") ||
               url.startsWith("/video") ||
               url.startsWith("/transcript") ||
               url.startsWith("/all");
    }

    static handleConnection(ws) {
        console.log("New handshake connection established");
        global.signalingWebsocket = ws;

        ws.on("close", () => SignalingHandler.handleClose());
        ws.on("error", () => SignalingHandler.handleError());
        ws.on("message", (data) => SignalingHandler.handleMessage(ws, data));
    }

    static handleError(error) {
        console.error("WebSocket server error:", error);
        global.isHandshakeServerActive = false;
        MediaHandler.closeMediaServer();
    }

    static handleClose() {
        console.log("Handshake server closed");
        global.isHandshakeServerActive = false;
        MediaHandler.closeMediaServer();
    }
}

module.exports = WSHandler; 