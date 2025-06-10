import io from 'socket.io-client';

class SpeechStreamingClient {
    constructor() {
        this.socket = null;
        this.mediaRecorder = null;
        this.audioContext = null;
        this.processor = null;
        this.source = null;
        this.isRecording = false;
        this.sessionId = null;

        this.audioTranscriptText = "";

        // Audio playback queue
        this.audioQueue = [];
        this.nextPlayTime = 0;
        this.playbackAudioContext = null;
    }

    connect() {
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
            this.onError?.(error);
        });

        this.socket.onAny((eventName, data) => {
            console.log('Socket event received:', eventName, data);
        });

        // Custom events

        this.socket.on('session_started', () => {
            console.log('Recognition session started');
            this.startRecording();
            this.onSessionStarted?.();
        });

        this.socket.on('session_stopped', () => {
            console.log('Recognition session stopped');
            this.onSessionStopped?.();
        });

        this.socket.on('response.audio_transcript.delta', (data) => {
            this.audioTranscriptText += data.delta;
            this.onAudioTranscriptDelta?.(data.delta);
        });

        this.socket.on('response.audio.delta', (data) => {
            this.playAudioDelta(data.delta);
        });
    }

    disconnect() {
        this.stopRecording();
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    async startSesssion() {
        // Start recognition session
        this.socket.emit('start_recognition');
    }

    async stopSession() {
        // Stop recognition session
        this.socket.emit('stop_recognition');
        this.stopRecording();
    }

    async startRecording() {
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
                this.socket.emit('audio_chunk', pcmData.buffer);
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
            this.isRecording = false;

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

            // Stop media tracks
            if (this.source && this.source.mediaStream) {
                this.source.mediaStream.getTracks().forEach(track => track.stop());
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

            // Calculate duration of this audio chunk
            const duration = audioBuffer.duration;

            // Ensure nextPlayTime is not in the past
            const currentTime = this.playbackAudioContext.currentTime;
            if (this.nextPlayTime < currentTime) {
                this.nextPlayTime = currentTime;
            }

            // Create and schedule the audio source
            const source = this.playbackAudioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.playbackAudioContext.destination);

            // Schedule playback at the next available time
            source.start(this.nextPlayTime);

            // Update nextPlayTime for the next audio chunk
            this.nextPlayTime += duration;

            console.log(`Scheduled audio chunk: start=${this.nextPlayTime - duration}, duration=${duration}`);

        } catch (error) {
            console.error('Error playing audio delta:', error);
        }
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
}

export default SpeechStreamingClient;