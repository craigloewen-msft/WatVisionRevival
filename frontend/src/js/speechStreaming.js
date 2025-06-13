class SpeechStreamingClient {
    constructor(watvision_parent) {
        this.mediaRecorder = null;
        this.audioContext = null;
        this.processor = null;
        this.source = null;
        this.isRecording = false;
        this.textToSpeech = window.speechSynthesis;

        this.playbackSpeed = 2.0;

        this.isReading = false;

        this.audioTranscriptText = "";

        // Audio playback queue
        this.audioQueue = [];
        this.nextPlayTime = 0;
        this.playbackAudioContext = null;

        this.watvision_parent = watvision_parent;
    }

    async startRecording() {
        // Prevent multiple recording sessions
        if (this.isRecording) {
            console.log("Recording already in progress, skipping start recording");
            return;
        }

        try {
            // Get microphone access
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 24000,
                    sampleSize: 16
                }
            });

            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 24000
            });

            this.source = this.audioContext.createMediaStreamSource(stream);

            // Create script processor for raw audio access
            const bufferSize = 4096;
            this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

            // Process audio chunks
            this.processor.onaudioprocess = (e) => {
                if (!this.isRecording) return;

                const inputData = e.inputBuffer.getChannelData(0);

                // Convert float32 to int16
                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    // Clamp values to 16-bit signed integer range
                    const sample = Math.max(-1, Math.min(1, inputData[i]));
                    pcmData[i] = Math.round(sample * 32767);
                }

                // Send audio chunk to backend
                this.watvision_parent.socket.emit('audio_chunk', pcmData.buffer);
            };

            // Connect audio nodes
            this.source.connect(this.processor);
            this.processor.connect(this.audioContext.destination);

            this.isRecording = true;

        } catch (error) {
            console.error('Error starting recording:', error);
            this.onError?.(error);
        }
    }

    stopRecording() {
        if (this.isRecording) {
            console.log("Stopping recording...");
            this.isRecording = false;

            // Stop media tracks first (before disconnecting source)
            if (this.source && this.source.mediaStream) {
                this.source.mediaStream.getTracks().forEach(track => track.stop());
            }

            // Disconnect audio nodes
            if (this.processor) {
                this.processor.disconnect();
                this.processor = null;
            }
            if (this.source) {
                this.source.disconnect();
                this.source = null;
            }
            if (this.audioContext) {
                this.audioContext.close();
                this.audioContext = null;
            }
        }
    }

    playAudioDelta(delta) {
        try {
            // Ensure we have a playback audio context
            if (!this.playbackAudioContext || this.playbackAudioContext.state === 'closed') {
                this.playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: 24000
                });
                // Reset timing when creating new context
                this.nextPlayTime = this.playbackAudioContext.currentTime;
            }

            // Audio comes in as base64 encoded string of pcm16 data
            const audioData = Uint8Array.from(atob(delta), c => c.charCodeAt(0));

            // Convert Uint8Array to Int16Array (PCM16 format)
            const pcm16Data = new Int16Array(audioData.buffer);

            // Create AudioBuffer manually for raw PCM data
            const audioBuffer = this.playbackAudioContext.createBuffer(
                1, // mono channel
                pcm16Data.length,
                24000 // sample rate
            );

            // Convert PCM16 to float32 and copy to AudioBuffer
            const channelData = audioBuffer.getChannelData(0);
            for (let i = 0; i < pcm16Data.length; i++) {
                channelData[i] = pcm16Data[i] / 32768.0; // Convert to float32 range [-1, 1]
            }

            // Calculate duration of this audio chunk accounting for playback rate
            const baseDuration = audioBuffer.duration;
            const actualDuration = baseDuration / this.playbackSpeed;

            // Ensure nextPlayTime is not in the past
            const currentTime = this.playbackAudioContext.currentTime;
            if (this.nextPlayTime < currentTime) {
                this.nextPlayTime = currentTime;
            }

            // Create and schedule the audio source
            const source = this.playbackAudioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.playbackRate.value = this.playbackSpeed
            source.connect(this.playbackAudioContext.destination);

            // Schedule playback at the next available time
            source.start(this.nextPlayTime);

            // Update nextPlayTime for the next audio chunk using actual duration
            this.nextPlayTime += actualDuration;

        } catch (error) {
            console.error('Error playing audio delta:', error);
        }
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
    }
}

export default SpeechStreamingClient;