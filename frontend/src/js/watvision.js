import axios from "axios";
import SpeechStreamingClient from "./speechStreaming";

class WatVision {

    constructor() {
        this.sourceImageCaptured = false;
        this.textToSpeech = window.speechSynthesis;
        this.lastReadText = null;
        this.isReading = false;
        this.speechClient = new SpeechStreamingClient();
    }

    async captureSourceImage(inputImageElement) {
        let imgBlob = await this.getImageBlob(inputImageElement);

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

    async step(inputImageElement, debugInputImageElement, debugReferenceImageElement) {
        let imgBlob = await this.getImageBlob(inputImageElement);

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
                this.readTextAloud(textUnderFinger.text);
                this.lastReadText = textUnderFinger.text;
            } else if (!textUnderFinger) {
                // Reset last read text when finger is not over any text
                this.lastReadText = null;
            }
        }

        return response.data;
    }

    // Method to convert text to speech
    readTextAloud(text) {
        if (!this.textToSpeech || this.isReading) return;

        this.isReading = true;

        // Cancel any ongoing speech
        this.textToSpeech.cancel();

        // Create a new speech synthesis utterance
        const utterance = new SpeechSynthesisUtterance(text);

        // Configure voice settings (optional)
        utterance.rate = 1.0; // Speed: 0.1 to 10
        utterance.pitch = 1.0; // Pitch: 0 to 2
        utterance.volume = 1.0; // Volume: 0 to 1

        // Handle events
        utterance.onend = () => {
            this.isReading = false;
        };

        utterance.onerror = (event) => {
            console.error("Speech synthesis error:", event);
            this.isReading = false;
        };

        // Speak the text
        this.textToSpeech.speak(utterance);

        console.log("Reading text:", text);
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
            session_id: this.speechClient.sessionId,
        });
        if (response.data.success) {
            console.log(response.data);
            const explanation = response.data;
            if (explanation) {
                this.readTextAloud(explanation.data);
            } else {
                console.warn("No explanation available for the current screen.");
            }
        } else {
            console.error("Failed to get explanation:", response.data.error);
        }
    }

    getSessionId() {
        return this.speechClient.sessionId;
    }
}

export default WatVision;