import axios from "axios";
import SpeechStreamingClient from "./speechStreaming";

class WatVision {

    constructor(inputImageElement, debugInputImageElement, debugReferenceImageElement) {
        this.sourceImageCaptured = false;
        this.lastReadText = null;
        this.speechClient = new SpeechStreamingClient(this);
        this.audioTranscriptText = ""; // Initialize audio transcript text

        this.socket = null;
        this.sessionId = null;

        this.trackingScreen = false;
        this.externalTrackingScreen = null;

        this.inputImageElement = inputImageElement;
        this.debugInputImageElement = debugInputImageElement;
        this.debugReferenceImageElement = debugReferenceImageElement;

        this.waitingForStepReply = false;
    }

    async captureSourceImage() {
        let imgBlob = await this.getImageBlob(this.inputImageElement);

        const base64Image = await this.blobToBase64(imgBlob);

        this.sendWebSocketMessage('set_source_image', {
            image: base64Image,
            session_id: this.getSessionId()
        });

        // Wait until 'this.sourceImageCaptured' is set to true
        return new Promise((resolve) => {
            const checkSourceImageCaptured = () => {
                if (this.sourceImageCaptured) {
                    resolve(true);
                } else {
                    setTimeout(checkSourceImageCaptured, 100); // Check every 100ms
                }
            };
            checkSourceImageCaptured();
        });
    }

    async step() {
        if (this.trackingScreen) {

            if (this.waitingForStepReply) {
                return null;
            }

            this.waitingForStepReply = true;

            let imgBlob = await this.getImageBlob(this.inputImageElement);

            const base64Image = await this.blobToBase64(imgBlob);

            this.sendWebSocketMessage('step', {
                image: base64Image,
                session_id: this.getSessionId()
            });

            return true;
        }
        else {
            return null;
        }
    }

    handleStepResponse(data) {
        console.log("Handling step response:", data);

        this.waitingForStepReply = false;

        let inputImageData = data.data.input_image;
        let sourceImageData = data.data.source_image;
        let textUnderFinger = data.data.text_under_finger;

        this.debugInputImageElement.src = `data:image/png;base64,${inputImageData}`;
        this.debugReferenceImageElement.src = `data:image/png;base64,${sourceImageData}`;

        // Automatically read out text under finger if it exists and is different from last read text
        if (textUnderFinger && textUnderFinger.text && textUnderFinger.text !== this.lastReadText) {
            this.speechClient.readTextAloud(textUnderFinger.text);
            this.lastReadText = textUnderFinger.text;
        } else if (!textUnderFinger) {
            // Reset last read text when finger is not over any text
            this.lastReadText = null;
        }
    }

    doesSourceImageExist() {
        return this.sourceImageCaptured;
    }

    async getImageBlob(inputElement) {
        let imgBlob;

        if (inputElement instanceof HTMLImageElement) {
            // Handle <img> element
            const imgSrcResponse = await fetch(inputElement.src);
            imgBlob = await imgSrcResponse.blob();
        } else if (inputElement instanceof HTMLCanvasElement) {
            // Handle <canvas> element
            imgBlob = await new Promise(resolve => {
                inputElement.toBlob(blob => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        throw new Error("Failed to create blob from canvas element.");
                    }
                }, "image/png");
            });
        } else {
            throw new Error("Input must be an image or canvas element.");
        }

        return imgBlob;
    }

    async explainScreen() {
        // Query the server for the explanation of the current screen
        const response = await axios.post("/api/explain_screen/", {
            session_id: this.getSessionId(),
        });
        if (response.data.success) {
            console.log(response.data);
            const explanation = response.data;
            if (explanation) {
                this.speechClient.readTextAloud(explanation.data);
            } else {
                console.warn("No explanation available for the current screen.");
            }
        } else {
            console.error("Failed to get explanation:", response.data.error);
        }
    }

    getSessionId() {
        return this.sessionId;
    }

    reset() {
        this.sessionId = null;
        this.sourceImageCaptured = false;
        this.audioTranscriptText = "";
        this.lastReadText = null;
        this.waitingForStepReply = false;
        this.stopTrackingScreen();
        this.speechClient.stopRecording();
    }

    connect() {
        // Prevent multiple connections
        if (this.socket) {
            console.log("WatVision already connected, skipping connection attempt");
            return;
        }

        const wsUrl = this.getWebSocketUrl();
        console.log("Connecting to WatVision WebSocket server at:", wsUrl);
        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
            console.log("Connected to WatVision WebSocket server");
        }

        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleWebSocketMessage(data);
        };

        this.socket.onclose = () => {
            console.log('WebSocket disconnected');
            // Attempt to reconnect after a delay
            setTimeout(() => {
                if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
                    console.log("Hit error will try to reconnect");
                }
            }, 3000);
        };

        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    // Handle incoming WebSocket messages
    handleWebSocketMessage(data) {
        console.log('Received WebSocket message:', data);

        switch (data.type) {
            case 'connected':
                console.log('Connected with session ID:', data.session_id);
                this.sessionId = data.session_id;
                this.onConnected?.(data.session_id);
                break;

            case 'disconnect':
                console.log('Disconnected from server');
                this.onDisconnect?.();
                break;

            case 'error':
                console.error('Socket error:', data.message || data); // in case error is just a string or object
                this.stopSession?.();
                this.reset?.();
                this.onError?.(data.message || data);
                break;

            case 'session_started':
                this.audioTranscriptText = ""; // Reset transcript text for new session
                this.speechClient?.startRecording();
                this.onSessionStarted?.();
                break;

            case 'session_stopped':
                this.reset?.();
                this.onSessionStopped?.();
                break;

            case 'response.audio_transcript.delta':
                this.audioTranscriptText += data.event.delta;
                this.onAudioTranscriptDelta?.(data.event.delta);
                break;

            case 'response.audio.delta':
                this.speechClient?.playAudioDelta(data.event.delta);
                break;

            case 'start_tracking_touchscreen':
                this.startTrackingScreen?.();
                break;

            case 'stop_tracking_touchscreen':
                this.stopTrackingScreen?.();
                break;

            case 'source_image_captured':
                console.log("Source image captured successfully");
                this.sourceImageCaptured = true;
                break;

            case 'source_image_set':
                console.log("Source image set successfully");
                this.sourceImageCaptured = true;
                break;

            case 'step_response':
                this.handleStepResponse(data);
                break;

            default:
                console.log('Unhandled message type:', data.type);
        }
    }

    disconnect() {
        console.log("Disconnecting WatVision instance...");

        if (this.speechClient) {
            this.speechClient.stopRecording();
        }

        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }

        this.reset();
    }

    async startSession() {
        // Start recognition session
        this.sendWebSocketMessage('start_session');
    }

    async stopSession() {
        // Stop recognition session
        this.sendWebSocketMessage('stop_session');
        this.reset();
    }

    async startTrackingScreen() {
        if (!this.sourceImageCaptured) {
            console.log("Capturing source image");
            await this.captureSourceImage();
        }

        this.trackingScreen = true;
        this.externalTrackingScreen?.(true);
    }

    stopTrackingScreen() {
        this.trackingScreen = false;
        this.externalTrackingScreen?.(false);
        this.sourceImageCaptured = false;
    }

    // Callback events
    setOnConnected(callback) {
        this.onConnected = callback;
    }

    setOnDisconnect(callback) {
        this.onDisconnect = callback;
    }

    setOnError(callback) {
        this.onError = callback;
    }

    // Custom events

    setOnSessionStarted(callback) {
        this.onSessionStarted = callback;
    }

    setOnSessionStopped(callback) {
        this.onSessionStopped = callback;
    }

    setOnAudioTranscriptDelta(callback) {
        this.onAudioTranscriptDelta = callback;
    }

    // Additional helpers

    setExternalTrackingScreen(setIsTracking) {
        this.externalTrackingScreen = setIsTracking;
    }

    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                // Remove the "data:image/png;base64," prefix
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // Send WebSocket message
    sendWebSocketMessage(type, data = {}) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: type,
                ...data
            }));
        } else {
            console.error('WebSocket not connected');
        }
    }

    getWebSocketUrl() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = process.env.NODE_ENV === 'development' ? window.location.hostname : "watvisionrevival-f8hfb8gpf5begkau.eastus2-01.azurewebsites.net";
        const port = process.env.NODE_ENV === 'development' ? ':8000' : '';
        return `${protocol}//${host}${port}/ws`;
    }
}

export default WatVision;