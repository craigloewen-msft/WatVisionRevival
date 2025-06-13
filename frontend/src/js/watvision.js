import axios from "axios";
import SpeechStreamingClient from "./speechStreaming";
import io from 'socket.io-client';

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
    }

    async captureSourceImage() {
        let imgBlob = await this.getImageBlob(this.inputImageElement);

        const formData = new FormData();
        formData.append("source", imgBlob, "image.png");
        formData.append("session_id", this.getSessionId());

        const response = await axios.post("/api/set_source_image/", formData, {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        });

        if (response.data.success) {
            this.sourceImageCaptured = true;
        }

        return response.data;
    }

    async step() {
        let debugInputImageElement = this.debugInputImageElement;
        let debugReferenceImageElement = this.debugReferenceImageElement;

        if (this.trackingScreen) {
            let imgBlob = await this.getImageBlob(this.inputImageElement);

            const formData = new FormData();
            formData.append("image", imgBlob, "image.png");
            formData.append("session_id", this.getSessionId());

            const response = await axios.post("/api/step/", formData, {
                headers: {
                    "Content-Type": "multipart/form-data",
                },
            });

            if (response.data.success) {
                let inputImageData = response.data.data.input_image;
                let sourceImageData = response.data.data.source_image;
                let textUnderFinger = response.data.data.text_under_finger;

                debugInputImageElement.src = `data:image/png;base64,${inputImageData}`;
                debugReferenceImageElement.src = `data:image/png;base64,${sourceImageData}`;

                // Automatically read out text under finger if it exists and is different from last read text
                if (textUnderFinger && textUnderFinger.text && textUnderFinger.text !== this.lastReadText) {
                    this.speechClient.readTextAloud(textUnderFinger.text);
                    this.lastReadText = textUnderFinger.text;
                } else if (!textUnderFinger) {
                    // Reset last read text when finger is not over any text
                    this.lastReadText = null;
                }
            }

            return response.data;
        }
        else {
            return null;
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
        this.stopTrackingScreen();
        this.speechClient.stopRecording();  
    }

    connect() {
        // Prevent multiple connections
        if (this.socket && this.socket.connected) {
            console.log("WatVision already connected, skipping connection attempt");
            return;
        }
        
        console.log("Connecting WatVision to backend...");
        
        // Connect to the backend WebSocket
        this.socket = io('ws://localhost:8080', {
            transports: ['websocket']
        });

        // Set up event listeners
        this.socket.on('connected', (data) => {
            console.log('Connected with session ID:', data.session_id);
            this.sessionId = data.session_id;
            this.onConnected?.(data.session_id);
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.onDisconnect?.();
        });

        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
            this.stopSession();
            this.reset();
            this.onError?.(error);
        });

        this.socket.onAny((eventName, data) => {
            // console.log('Socket event received:', eventName, data);
        });

        // Custom events

        this.socket.on('session_started', () => {
            this.audioTranscriptText = ""; // Reset transcript text for new session
            this.speechClient.startRecording();
            this.onSessionStarted?.();
        });

        this.socket.on('session_stopped', () => {
            this.reset();
            this.onSessionStopped?.();
        });

        this.socket.on('response.audio_transcript.delta', (data) => {
            this.audioTranscriptText += data.delta;
            this.onAudioTranscriptDelta?.(data.delta);
        });

        this.socket.on('response.audio.delta', (data) => {
            this.speechClient.playAudioDelta(data.delta);
        });

        this.socket.on('start_tracking_touchscreen', () => {
            console.log("Received start_tracking_screen event");
            this.startTrackingScreen();
        });

        this.socket.on('stop_tracking_touchscreen', () => {
            this.stopTrackingScreen();
        });
    }

    disconnect() {
        console.log("Disconnecting WatVision instance...");
        
        if (this.speechClient) {
            this.speechClient.stopRecording();
        }
        
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        
        this.reset();
    }

    async startSession() {
        // Start recognition session
        this.socket.emit('start_session');
    }

    async stopSession() {
        // Stop recognition session
        this.socket.emit('stop_session');
        this.reset();
    }

    async startTrackingScreen() {
        if (!this.sourceImageCaptured) {
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
}

export default WatVision;